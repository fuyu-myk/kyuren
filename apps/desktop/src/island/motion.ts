import { stepWith, type Spring } from "./spring.ts";

/// The island's size, which is all that moves when it grows and folds.
export type Size = { width: number; height: number; radius: number; ear: number };

/// Growing springs out with a slight overshoot, a half second to settle; folding is firmer and
/// does not overshoot, so the island tucks back into the notch rather than bouncing there.
export const GROW = { stiffness: 158, damping: 18.1 };
export const FOLD = { stiffness: 900, damping: 60 };

export type Moving = { width: Spring; height: Spring; radius: Spring; ear: Spring };

export function still(size: Size): Moving {
  return {
    width: { value: size.width, velocity: 0 },
    height: { value: size.height, velocity: 0 },
    radius: { value: size.radius, velocity: 0 },
    ear: { value: size.ear, velocity: 0 },
  };
}

export function current(m: Moving): Size {
  return { width: m.width.value, height: m.height.value, radius: m.radius.value, ear: m.ear.value };
}

export function moved(m: Moving, to: Size, dt: number): Moving {
  // The same spring for every part, chosen by the area, so width and height arrive together.
  const shrinking = to.width * to.height < m.width.value * m.height.value;
  const { stiffness, damping } = shrinking ? FOLD : GROW;
  return {
    width: stepWith(m.width, to.width, dt, stiffness, damping),
    height: stepWith(m.height, to.height, dt, stiffness, damping),
    radius: stepWith(m.radius, to.radius, dt, stiffness, damping),
    ear: stepWith(m.ear, to.ear, dt, stiffness, damping),
  };
}

export function settled(m: Moving, to: Size): boolean {
  const near = (spring: Spring, target: number) => Math.abs(spring.value - target) < 0.25 && Math.abs(spring.velocity) < 0.5;
  return near(m.width, to.width) && near(m.height, to.height) && near(m.radius, to.radius) && near(m.ear, to.ear);
}

/// Near enough its size to hold what goes inside it. Anything shown sooner is seen ahead of the
/// island it belongs in.
export function grown(m: Moving, to: Size): boolean {
  const near = (spring: Spring, target: number) => Math.abs(spring.value - target) <= target * 0.04;
  return near(m.width, to.width) && near(m.height, to.height);
}
