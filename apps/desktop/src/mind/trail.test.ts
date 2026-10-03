import assert from "node:assert/strict";
import { test } from "node:test";
import { follow, start } from "./trail.ts";

const FRAME = 1 / 60;

function chase(to: { x: number; y: number }, frames: number, from = start(0, 0)) {
  let trail = from;
  for (let at = 0; at < frames; at += 1) trail = follow(trail, to.x, to.y, FRAME);
  return trail;
}

test("a drawn orb catches up with where it belongs", () => {
  const caught = chase({ x: 300, y: -120 }, 240);
  assert.ok(Math.hypot(caught.x - 300, caught.y + 120) < 0.5);
});

test("it lags at first, which is the whole point", () => {
  const soon = chase({ x: 300, y: 0 }, 3);
  assert.ok(soon.x < 300 * 0.6, "an orb that arrives at once does not swim");
  assert.ok(soon.x > 0, "an orb that never sets off is stuck");
});

test("it springs past a little and comes back, rather than running away", () => {
  let trail = start(0, 0);
  let furthest = 0;
  for (let at = 0; at < 600; at += 1) {
    trail = follow(trail, 300, 0, FRAME);
    furthest = Math.max(furthest, trail.x);
  }
  assert.ok(furthest > 300, "a spring with no give in it is a jump");
  assert.ok(furthest < 300 * 1.25, `${furthest} is a bounce, not a spring`);
  assert.ok(Math.abs(trail.x - 300) < 0.5, "and it ends where it was going");
});

test("a frame that took too long does not throw it across the screen", () => {
  const jumped = follow(start(0, 0), 900, 0, 8);
  assert.ok(Math.abs(jumped.x) < 900, "a stalled machine must not fling the whirlpool");
});
