import { useEffect, useRef } from "react";
import { on } from "@/island/channels";
import { analysed, BANDS, FALLBACK, follow, paletteOf, RESPONSE, settled, struck } from "@/island/visualizer";

/// Both halves, the music drawn above the middle and mirrored below it.
const HEIGHT = 48;
/// How much of its slot a bar takes, the rest left as air for the response to show through.
const FILL = 0.3;
/// How long nothing at all may come through while a track plays before it is taken as not heard.
const UNHEARD = 3_000;

/// One measure of the music: its bands, the same finer for the response, and how hard it just hit.
type Heard = { bands: number[]; response: number[]; impact: number };

const NOTHING: Heard = { bands: new Array<number>(BANDS).fill(0), response: new Array<number>(RESPONSE).fill(0), impact: 0 };

type Props = {
  /// Whether the music is being heard: a track playing with the widget in sight.
  live: boolean;
  art: string | null;
  /// Told whether the music is coming through as nothing at all, as when macOS has not let it.
  onUnheard: (unheard: boolean) => void;
};

/// The response's outline from the left edge to the right, smoothed between its steps, each over
/// its own place in the spectrum as the bars are.
function trace(path: Path2D, response: number[], width: number, floor: number, reach: number): void {
  const step = width / response.length;
  const at = (index: number): [number, number] => [(index + 0.5) * step, floor - response[index]! * reach];
  const last = response.length - 1;
  path.lineTo(0, at(0)[1]);
  path.lineTo(...at(0));
  for (let index = 1; index < last; index++) {
    const [x, y] = at(index);
    const [nextX, nextY] = at(index + 1);
    path.quadraticCurveTo(x, y, (x + nextX) / 2, (y + nextY) / 2);
  }
  path.lineTo(...at(last));
  path.lineTo(width, at(last)[1]);
}

function paint(context: CanvasRenderingContext2D, element: HTMLCanvasElement, bars: number[], response: number[], impact: number, [from, to]: [string, string]): void {
  const ratio = window.devicePixelRatio || 1;
  const width = element.clientWidth;
  if (element.width !== Math.round(width * ratio)) {
    element.width = Math.round(width * ratio);
    element.height = Math.round(HEIGHT * ratio);
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, HEIGHT);

  const middle = HEIGHT / 2;
  const reach = middle - 2;
  const tint = context.createLinearGradient(0, 0, width, 0);
  tint.addColorStop(0, from);
  tint.addColorStop(1, to);

  // The response, as an analyser shows it behind an equaliser, above the middle and again mirrored
  // below it: filled faintly and fading toward the middle, with its outline over it, both
  // brightening as the music hits.
  for (const mirrored of [false, true]) {
    context.setTransform(ratio, 0, 0, mirrored ? -ratio : ratio, 0, mirrored ? HEIGHT * ratio : 0);
    const area = new Path2D();
    area.moveTo(0, middle);
    trace(area, response, width, middle, reach);
    area.lineTo(width, middle);
    area.closePath();
    context.fillStyle = tint;
    context.globalAlpha = 0.24 + 0.36 * impact;
    context.fill(area);
    const fade = context.createLinearGradient(0, 0, 0, middle);
    fade.addColorStop(0, "rgb(0 0 0 / 0)");
    fade.addColorStop(1, "rgb(0 0 0 / 0.9)");
    context.globalCompositeOperation = "destination-out";
    context.globalAlpha = 1;
    context.fillStyle = fade;
    context.fillRect(0, 0, width, middle);
    context.globalCompositeOperation = "source-over";

    const outline = new Path2D();
    outline.moveTo(0, middle - response[0]! * reach);
    trace(outline, response, width, middle, reach);
    context.strokeStyle = tint;
    context.lineWidth = 1;
    context.globalAlpha = 0.3 + 0.4 * impact;
    context.stroke(outline);
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);

  // Each bar reaches as far below the middle as above it, drawn whole so the halves do not pinch
  // where they meet.
  const slot = width / BANDS;
  const bar = slot * FILL;
  context.fillStyle = tint;
  context.globalAlpha = 0.8 + 0.2 * impact;
  bars.forEach((level, index) => {
    const half = Math.max(bar / 2, struck(level, impact) * reach);
    context.beginPath();
    context.roundRect(index * slot + (slot - bar) / 2, middle - half, bar, 2 * half, bar / 2);
    context.fill();
  });
  context.globalAlpha = 1;
}

/// What plays, drawn under the music widget as an equaliser would show it, mirrored about its middle:
/// bars that jump with each band of the music over the response, finer, fainter and keener, that an
/// analyser draws behind them. A
/// hit well over the music before it lifts the bars and lights the response. Coloured from the
/// cover, and still once the music is.
export function Visualizer({ live, art, onUnheard }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const heard = useRef<Heard>(NOTHING);
  const palette = useRef<[string, string]>(FALLBACK);
  const wake = useRef<() => void>(() => undefined);
  const silentSince = useRef<number | null>(null);
  const unheard = useRef(onUnheard);
  unheard.current = onUnheard;

  useEffect(() => {
    palette.current = FALLBACK;
    wake.current();
    if (!art) return;
    const image = new Image();
    image.onload = () => {
      const small = document.createElement("canvas");
      small.width = 8;
      small.height = 8;
      const context = small.getContext("2d", { willReadFrequently: true });
      if (!context) return;
      context.drawImage(image, 0, 0, 8, 8);
      try {
        palette.current = paletteOf(context.getImageData(0, 0, 8, 8).data, 8, 8);
      } catch {
        // A cover the page may not read keeps the island's own colours.
        palette.current = FALLBACK;
      }
      wake.current();
    };
    image.src = art;
    return () => {
      image.onload = null;
    };
  }, [art]);

  useEffect(() => {
    const listening = on<Heard & { silent: boolean }>("music:bands", (got) => {
      heard.current = { bands: got.bands.slice(0, BANDS), response: got.response.slice(0, RESPONSE), impact: got.impact };
      if (got.silent) {
        silentSince.current ??= Date.now();
        if (Date.now() - silentSince.current > UNHEARD) unheard.current(true);
      } else {
        silentSince.current = null;
        unheard.current(false);
      }
      wake.current();
    });
    return () => {
      void listening.then((stop) => stop());
      unheard.current(false);
    };
  }, []);

  // Paused or folded away, nothing more is heard, so the bars come down rather than holding the
  // last of it, and drawing stops once they are down.
  useEffect(() => {
    silentSince.current = null;
    if (live) return;
    heard.current = NOTHING;
    unheard.current(false);
    wake.current();
  }, [live]);

  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;
    let bars = NOTHING.bands;
    let response = NOTHING.response;
    let impact = 0;
    let frame = 0;
    let last = performance.now();
    const draw = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;
      const got = heard.current;
      bars = follow(bars, got.bands, dt, 35, 160);
      // The response is keener and slower than the bars, as an analyser's is, and a hit dies away
      // after it lands.
      response = follow(response, got.response.map(analysed), dt, 60, 320);
      impact = follow([impact], [got.impact], dt, 15, 260)[0]!;
      paint(context, element, bars, response, impact, palette.current);
      // Drawing stops once all has come to rest, and the next sound wakes it.
      const resting = [got.bands, got.response, [got.impact], bars, response, [impact]].every(settled);
      frame = resting ? 0 : requestAnimationFrame(draw);
    };
    wake.current = () => {
      if (frame) return;
      last = performance.now();
      frame = requestAnimationFrame(draw);
    };
    wake.current();
    return () => {
      cancelAnimationFrame(frame);
      wake.current = () => undefined;
    };
  }, []);

  return <canvas ref={canvas} className="visualizer" aria-hidden="true" />;
}
