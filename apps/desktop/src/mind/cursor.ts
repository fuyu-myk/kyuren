import { INK, shade } from "./palette.ts";
import type { Point } from "./space.ts";

/// The whole hand, as the tracker sees it: a joint at each knuckle and a bone between them, the
/// way MediaPipe numbers them, wrist first and each finger base to tip. Thumb and index tips are
/// drawn brighter, and draw together into one point as a pinch closes, because that point is
/// what a pinch takes. Nothing else on screen is drawn in white, which is what makes the hand
/// read as yours rather than Kyuren's.
const BONES: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];
export const JOINTS = 21;
const THUMB = 4;
const INDEX = 8;

const JOINT = 2.2;
const TIP = 4.5;
const MET = 8;

export function drawHand(
  paint: CanvasRenderingContext2D,
  hand: Point[],
  pinch: number,
  shown: number,
): void {
  if (shown <= 0 || hand.length < JOINTS) return;

  const shut = Math.max(0, Math.min(1, pinch));
  const thumb = hand[THUMB]!;
  const index = hand[INDEX]!;

  paint.save();
  paint.globalCompositeOperation = "lighter";

  paint.strokeStyle = shade(INK.periwinkle, 0.6 * shown);
  paint.lineWidth = 1.9;
  for (const [from, to] of BONES) {
    paint.beginPath();
    paint.moveTo(hand[from]!.x, hand[from]!.y);
    paint.lineTo(hand[to]!.x, hand[to]!.y);
    paint.stroke();
  }

  paint.fillStyle = shade(INK.periwinkle, 0.5 * shown);
  for (const [which, joint] of hand.entries()) {
    if (which === THUMB || which === INDEX) continue;
    paint.beginPath();
    paint.arc(joint.x, joint.y, JOINT, 0, Math.PI * 2);
    paint.fill();
  }

  const radius = TIP + (MET - TIP) * shut;
  for (const tip of [thumb, index]) {
    const glow = paint.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, radius * 3);
    glow.addColorStop(0, shade(INK.periwinkle, 0.25 * shown));
    glow.addColorStop(1, shade(INK.periwinkle, 0));
    paint.fillStyle = glow;
    paint.beginPath();
    paint.arc(tip.x, tip.y, radius * 3, 0, Math.PI * 2);
    paint.fill();

    paint.fillStyle = shade(INK.periwinkle, (0.6 + 0.35 * shut) * shown);
    paint.beginPath();
    paint.arc(tip.x, tip.y, radius, 0, Math.PI * 2);
    paint.fill();
  }

  paint.restore();
}
