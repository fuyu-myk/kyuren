import { useEffect, useRef } from "react";
import { on } from "@/island/channels";
import { BANDS, bellAt, bellsOf, FALLBACK, follow, followBells, paletteOf, settled, type Bell } from "@/island/visualizer";

const HEIGHT = 34;
/// How much of its slot a bar takes, the rest left as air for the bells to show through.
const FILL = 0.3;
/// The node at each bell's peak, pale, as an equaliser marks the bands it shapes.
const NODE = "rgb(245 247 255)";
/// How long nothing at all may come through while a track plays before it is taken as not heard.
const UNHEARD = 3_000;

type Props = {
  /// Whether the music is being heard: a track playing with the widget in sight.
  live: boolean;
  art: string | null;
  /// Told whether the music is coming through as nothing at all, as when macOS has not let it.
  onUnheard: (unheard: boolean) => void;
};

/// A bell's outline along the strip, from its foot on the left to its foot on the right.
function bellPath(bell: Bell, slot: number, width: number, floor: number, reach: number): Path2D {
  const path = new Path2D();
  path.moveTo(0, floor);
  for (let x = 0; x <= width; x += 2) path.lineTo(x, floor - bellAt(bell, x / slot - 0.5) * reach);
  path.lineTo(width, floor);
  return path;
}

function paint(context: CanvasRenderingContext2D, element: HTMLCanvasElement, bars: number[], bells: Bell[], [from, to]: [string, string]): void {
  const ratio = window.devicePixelRatio || 1;
  const width = element.clientWidth;
  if (element.width !== Math.round(width * ratio)) {
    element.width = Math.round(width * ratio);
    element.height = Math.round(HEIGHT * ratio);
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, HEIGHT);

  const floor = HEIGHT - 1;
  const reach = HEIGHT - 5;
  const slot = width / BANDS;
  const bar = slot * FILL;
  const tint = context.createLinearGradient(0, 0, width, 0);
  tint.addColorStop(0, from);
  tint.addColorStop(1, to);
  context.fillStyle = tint;
  context.strokeStyle = tint;

  context.globalAlpha = 0.8;
  bars.forEach((level, index) => {
    const height = Math.max(bar, level * reach);
    context.beginPath();
    context.roundRect(index * slot + (slot - bar) / 2, floor - height, bar, height, bar / 2);
    context.fill();
  });

  // The response: a bell for each part of the music, filled faintly over the bars it rises from.
  const paths = bells.map((bell) => bellPath(bell, slot, width, floor, reach));
  context.globalAlpha = 0.2;
  for (const path of paths) context.fill(path);
  context.globalAlpha = 0.9;
  context.lineWidth = 1.2;
  for (const path of paths) context.stroke(path);

  context.fillStyle = NODE;
  for (const bell of bells) {
    if (bell.height < 0.02) continue;
    context.beginPath();
    context.arc((bell.centre + 0.5) * slot, floor - bell.height * reach, 1.8, 0, 2 * Math.PI);
    context.fill();
  }
  context.globalAlpha = 1;
}

/// What plays, drawn under the music widget as an equaliser would show it: bars that jump with each
/// band of the music, and over them a bell for each part of it, rising with that part and gliding
/// to where it gathers. Coloured from the cover, and still once the music is.
export function Visualizer({ live, art, onUnheard }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const heard = useRef<number[]>(new Array<number>(BANDS).fill(0));
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
    const listening = on<{ bands: number[]; silent: boolean }>("music:bands", (got) => {
      heard.current = got.bands.slice(0, BANDS);
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
    heard.current = new Array<number>(BANDS).fill(0);
    unheard.current(false);
    wake.current();
  }, [live]);

  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;
    let bars = new Array<number>(BANDS).fill(0);
    let bells = bellsOf(bars);
    let frame = 0;
    let last = performance.now();
    const draw = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;
      bars = follow(bars, heard.current, dt, 35, 160);
      bells = followBells(bells, bellsOf(bars), dt);
      paint(context, element, bars, bells, palette.current);
      // Drawing stops once all has come to rest, and the next sound wakes it.
      frame = settled(heard.current) && settled(bars) && settled(bells.map((bell) => bell.height)) ? 0 : requestAnimationFrame(draw);
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
