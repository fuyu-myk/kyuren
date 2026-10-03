export type Trail = { x: number; y: number; vx: number; vy: number };

/// How eagerly a drawn orb chases where it now belongs on the canvas, and how quickly that chase
/// is damped. Together they are what makes the whirlpool swim rather than snap when it turns.
const CHASE = 80;
const SETTLE = 9;

const LONGEST = 0.05;

export function start(x: number, y: number): Trail {
  return { x, y, vx: 0, vy: 0 };
}

export function follow(trail: Trail, x: number, y: number, seconds: number): Trail {
  const over = Math.min(LONGEST, seconds);
  const vx = trail.vx + ((x - trail.x) * CHASE - trail.vx * SETTLE) * over;
  const vy = trail.vy + ((y - trail.y) * CHASE - trail.vy * SETTLE) * over;
  return { x: trail.x + vx * over, y: trail.y + vy * over, vx, vy };
}
