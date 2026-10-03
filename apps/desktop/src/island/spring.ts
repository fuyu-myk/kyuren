export type Spring = {
  value: number;
  velocity: number;
};

const STIFFNESS = 260;
const DAMPING = 11;
const SUBSTEP = 1 / 240;

/// Underdamped on purpose: the orb should overshoot slightly and settle rather than glide.
export function step(spring: Spring, target: number, dt: number): Spring {
  return stepWith(spring, target, dt, STIFFNESS, DAMPING);
}

/// The same integration with a spring of one's own.
export function stepWith(spring: Spring, target: number, dt: number, stiffness: number, damping: number): Spring {
  let { value, velocity } = spring;

  // Large frames would make a stiff spring explode, so integrate at a fixed rate regardless.
  let remaining = Math.min(dt, 0.1);
  while (remaining > 0) {
    const slice = Math.min(SUBSTEP, remaining);
    remaining -= slice;

    const acceleration = (target - value) * stiffness - velocity * damping;
    velocity += acceleration * slice;
    value += velocity * slice;
  }

  return { value, velocity };
}
