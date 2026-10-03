/// A place in the whirlpool: across and along its surface, and how far it stands above it.
export type Spot = { x: number; y: number; lift: number };

export type Size = { width: number; height: number };

export type Point = { x: number; y: number };

/// Where the whirlpool is seen from: how far it has turned about its own axis, how far above its
/// surface the eye sits, and how close in it is.
export type Camera = {
  spin: number;
  tilt: number;
  zoom: number;
};

/// Seen edge on, a whirlpool is a line; seen from directly overhead it is a flat picture. The
/// limits keep both away, so there is always some depth to read.
export const LEAST_TILT = 0.14;
export const MOST_TILT = 1.32;

export const NEAREST = 2.6;
export const FURTHEST = 0.3;

/// How far the eye sits from the middle, in layout units. Near arms are larger than far ones
/// because they are nearer, not because they were drawn that way.
export const EYE = 1600;

export const START: Camera = { spin: 0, tilt: 0.72, zoom: 1 };

/// Where the middle of the whirlpool falls on the canvas.
export function middleOf(size: Size): Point {
  return { x: size.width / 2, y: size.height / 2 };
}

export type Seen = {
  x: number;
  y: number;
  /// Towards the eye. Larger is nearer, and decides what is drawn over what.
  depth: number;
  /// How much nearness enlarges a thing. One at the middle, more in front, less behind.
  near: number;
};

/// Where a place in the whirlpool falls on the canvas, once it has been turned, seen from above at
/// an angle, and made smaller for being further away.
export function look(at: Spot, camera: Camera, size: Size): Seen {
  const across = Math.cos(camera.spin);
  const along = Math.sin(camera.spin);
  const x = at.x * across + at.y * along;
  const y = at.y * across - at.x * along;

  const above = Math.sin(camera.tilt);
  const beside = Math.cos(camera.tilt);
  const depth = at.lift * above - y * beside;
  const up = y * above + at.lift * beside;

  const near = EYE / Math.max(1, EYE - depth);
  const middle = middleOf(size);
  return {
    x: x * near * camera.zoom + middle.x,
    y: -up * near * camera.zoom + middle.y,
    depth,
    near,
  };
}

export function spun(camera: Camera, by: number): Camera {
  const turn = Math.PI * 2;
  return { ...camera, spin: (((camera.spin + by) % turn) + turn) % turn };
}

export function tipped(camera: Camera, by: number): Camera {
  return { ...camera, tilt: Math.min(MOST_TILT, Math.max(LEAST_TILT, camera.tilt + by)) };
}

export function zoomed(camera: Camera, by: number): Camera {
  return { ...camera, zoom: Math.min(NEAREST, Math.max(FURTHEST, camera.zoom * by)) };
}

/// The whirlpool turns on its own, slowly enough that it is felt rather than watched: a full turn
/// takes seven minutes, so the arrangement is never still and never seen to move.
export const DRIFT = 0.015;

export function drift(camera: Camera, seconds: number): Camera {
  return spun(camera, DRIFT * seconds);
}

/// Momentum after the pointer lets go, and how quickly it stops.
const GLIDE = 0.9;
const STILL = 0.0002;

export function coast(camera: Camera, speed: number): { camera: Camera; speed: number } {
  if (Math.abs(speed) < STILL) return { camera, speed: 0 };
  return { camera: spun(camera, speed), speed: speed * GLIDE };
}

/// Eases a position towards where it now belongs, at a rate that does not depend on how often the
/// frames come. Nothing in the arrangement ever jumps: it swims.
export function toward(at: number, to: number, seconds: number, rate: number): number {
  return at + (to - at) * (1 - Math.exp(-rate * seconds));
}

/// Where on the surface of the whirlpool a point on the canvas falls, given how high above that
/// surface the answer should sit. The exact inverse of looking at it, which is what lets an orb be
/// taken hold of and moved rather than only pointed at.
export function reach(
  at: Point,
  lift: number,
  camera: Camera,
  size: Size,
): Spot | undefined {
  const above = Math.sin(camera.tilt);
  const beside = Math.cos(camera.tilt);
  const middle = middleOf(size);

  const up = -(at.y - middle.y) / camera.zoom;
  const back = EYE - lift * above;
  const bottom = up * beside - EYE * above;
  if (Math.abs(bottom) < 1e-6) return undefined;

  const along = (EYE * lift * beside - up * back) / bottom;
  const near = EYE / (back + along * beside);
  if (!Number.isFinite(near) || near <= 0) return undefined;

  const across = (at.x - middle.x) / (near * camera.zoom);
  const turn = Math.cos(camera.spin);
  const swing = Math.sin(camera.spin);
  return { x: across * turn - along * swing, y: across * swing + along * turn, lift };
}
