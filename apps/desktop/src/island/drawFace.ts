import { presence, spinOffset } from "@/island/appear";
import type { Face } from "@/island/face";
import { RISE } from "@/island/place";
import { drawCore } from "@/mind/core";

/// Draws the icosahedron where it stands, clipped to the island's outline so its light stays
/// inside the glass. Rising away into the notch, it shrinks as it goes.
export function drawFace(canvas: HTMLCanvasElement, face: Face, at: { x: number; y: number }, size: number, outline: string): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const here = presence(face.transition, face.t);
  const alpha = face.motion.alpha * Math.min(1, Math.max(0, here));
  if (alpha < 0.01) return;
  const rise = Math.min(1, Math.max(0, -face.motion.y.value / RISE));
  const radius = size * Math.max(face.scale.value, 0.02) * Math.max(here, 0.001) * (1 - 0.4 * rise);

  ctx.save();
  ctx.clip(new Path2D(outline));
  ctx.globalAlpha = alpha;
  drawCore(
    ctx,
    { x: at.x + face.motion.x.value, y: at.y + face.motion.y.value },
    radius,
    face.clock + spinOffset(face.transition, face.t) * 3,
    1,
    { swell: Math.min(1, Math.max(0, face.level)) },
  );
  ctx.restore();
}
