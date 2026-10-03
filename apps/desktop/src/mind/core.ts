import { motesAt } from "./motes.ts";
import { shade, INK, type Rgb } from "./palette.ts";

const PHI = (1 + Math.sqrt(5)) / 2;

type Corner = [number, number, number];

const SPARS: Corner[] = [
  [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
  [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
  [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
];

const CORNERS: Corner[] = SPARS.map(([x, y, z]): Corner => {
  const long = Math.hypot(x, y, z);
  return [x / long, y / long, z / long];
});

const STRUTS: Array<readonly [number, number]> = [
  [0, 1], [0, 5], [0, 7], [0, 10], [0, 11],
  [1, 5], [1, 7], [1, 8], [1, 9],
  [2, 3], [2, 4], [2, 6], [2, 10], [2, 11],
  [3, 4], [3, 6], [3, 8], [3, 9],
  [4, 5], [4, 9], [4, 11],
  [5, 9], [5, 11],
  [6, 7], [6, 8], [6, 10],
  [7, 8], [7, 10],
  [8, 9],
  [10, 11],
];

const AWAY = 3.2;
const RAYS = 14;

function fading(
  canvas: CanvasRenderingContext2D,
  tip: { x: number; y: number },
  ink: Rgb,
  alpha: number,
): CanvasGradient {
  const fade = canvas.createLinearGradient(0, 0, tip.x, tip.y);
  fade.addColorStop(0, shade(ink, alpha));
  fade.addColorStop(0.35, shade(ink, alpha * 0.6));
  fade.addColorStop(1, shade(ink, 0));
  return fade;
}

function turned([x, y, z]: Corner, moment: number): [number, number] {
  const ax = moment * 0.12;
  const ay = moment * 0.19;
  const az = moment * 0.07;

  const y1 = y * Math.cos(ax) - z * Math.sin(ax);
  const z1 = y * Math.sin(ax) + z * Math.cos(ax);
  const x2 = x * Math.cos(ay) + z1 * Math.sin(ay);
  const z2 = z1 * Math.cos(ay) - x * Math.sin(ay);
  const x3 = x2 * Math.cos(az) - y1 * Math.sin(az);
  const y3 = x2 * Math.sin(az) + y1 * Math.cos(az);

  const flat = AWAY / (AWAY - z2);
  return [x3 * flat, y3 * flat];
}

/// How the thing is to look beyond its size: its colour, and how far it is swelling, from at
/// rest to full, which reaches the rays, the rings, the wash and the motes together.
export type Look = {
  colour?: Rgb;
  swell?: number;
};

/// What the whirlpool turns around, and what stands for Kyuren when it is summoned. Everything
/// else in the mind is something Kyuren knows or can do; this is Kyuren, so it is drawn as a made
/// thing rather than as another orb, and the same drawing serves both places.
export function drawCore(
  canvas: CanvasRenderingContext2D,
  at: { x: number; y: number },
  radius: number,
  moment: number,
  strength: number,
  look: Look = {},
): void {
  if (strength <= 0.01) return;
  const ink = look.colour ?? INK.periwinkle;
  const swell = look.swell ?? 0;

  canvas.save();
  canvas.translate(at.x, at.y);
  canvas.globalCompositeOperation = "lighter";

  // The light this thing gives off is drawn before the thing itself: a wide wash, then the rays,
  // then the rings, then the frame. All of it adds to what is beneath, so the middle burns white
  // without any of it being painted white.
  const spread = radius * 3.1 * (1 + 0.35 * swell);
  const wash = canvas.createRadialGradient(0, 0, 0, 0, 0, spread);
  wash.addColorStop(0, shade(ink, 0.2 * strength));
  wash.addColorStop(0.18, shade(ink, 0.12 * strength));
  wash.addColorStop(0.55, shade(ink, 0.04 * strength));
  wash.addColorStop(1, shade(ink, 0));
  canvas.fillStyle = wash;
  canvas.beginPath();
  canvas.arc(0, 0, spread, 0, Math.PI * 2);
  canvas.fill();

  // Each ray twice, as the threads are drawn: wide and soft for the light around it, then narrow
  // and bright for the ray itself.
  canvas.lineCap = "round";
  for (let ray = 0; ray < RAYS; ray += 1) {
    const angle = (ray / RAYS) * Math.PI * 2 + moment * 0.05;
    const reach = radius * (2.4 + 0.9 * Math.sin(moment * 1.3 + ray)) * (1 + 0.5 * swell);
    const tip = { x: Math.cos(angle) * reach, y: Math.sin(angle) * reach };
    canvas.beginPath();
    canvas.moveTo(0, 0);
    canvas.lineTo(tip.x, tip.y);
    canvas.strokeStyle = fading(canvas, tip, ink, 0.2 * strength);
    canvas.lineWidth = 9;
    canvas.stroke();
    canvas.strokeStyle = fading(canvas, tip, ink, 0.68 * strength);
    canvas.lineWidth = 3;
    canvas.stroke();
  }
  canvas.lineCap = "butt";

  canvas.shadowColor = shade(ink, 0.55 * strength);
  canvas.shadowBlur = radius * 0.4;

  for (const [ring, squash, speed] of [[1.7, 0.3, 0.5], [2.05, 0.52, -0.36]] as const) {
    canvas.save();
    canvas.rotate(moment * speed);
    canvas.scale(1, squash);
    canvas.strokeStyle = shade(ink, 0.62 * strength);
    canvas.lineWidth = 1.8;
    canvas.setLineDash(ring > 1.8 ? [22, 9] : [17, 9, 3, 9]);
    canvas.beginPath();
    canvas.arc(0, 0, radius * ring * (1 + 0.12 * swell), 0, Math.PI * 2);
    canvas.stroke();
    canvas.restore();
  }

  canvas.setLineDash([]);
  const corners = CORNERS.map((corner) => turned(corner, moment));
  canvas.beginPath();
  for (const [one, two] of STRUTS) {
    canvas.moveTo(corners[one]![0] * radius, corners[one]![1] * radius);
    canvas.lineTo(corners[two]![0] * radius, corners[two]![1] * radius);
  }
  canvas.strokeStyle = shade(ink, 0.2 * strength);
  canvas.lineWidth = 3;
  canvas.stroke();
  canvas.strokeStyle = shade(ink, 0.95 * strength);
  canvas.lineWidth = 1.2;
  canvas.stroke();

  const drift = radius * (1 + 0.3 * swell);
  for (const mote of motesAt(moment)) {
    canvas.fillStyle = shade(ink, mote.alpha * strength);
    canvas.beginPath();
    canvas.arc(
      Math.cos(mote.angle) * mote.far * drift,
      Math.sin(mote.angle) * mote.far * drift,
      mote.size * radius,
      0,
      Math.PI * 2,
    );
    canvas.fill();
  }

  const heart = canvas.createRadialGradient(0, 0, 0, 0, 0, radius * 0.6);
  heart.addColorStop(0, shade(ink, 0.4 * strength));
  heart.addColorStop(1, shade(ink, 0));
  canvas.fillStyle = heart;
  canvas.beginPath();
  canvas.arc(0, 0, radius * 0.6, 0, Math.PI * 2);
  canvas.fill();

  canvas.shadowBlur = 0;

  canvas.globalCompositeOperation = "source-over";
  canvas.restore();
}
