import assert from "node:assert/strict";
import { test } from "node:test";
import { step, type Spring } from "./spring.ts";

function settle(target: number, frames: number, dt = 1 / 120): Spring {
  let spring: Spring = { value: 0, velocity: 0 };
  for (let i = 0; i < frames; i += 1) {
    spring = step(spring, target, dt);
  }
  return spring;
}

test("a spring converges on its target", () => {
  const settled = settle(1, 400);
  assert.ok(Math.abs(settled.value - 1) < 0.001, `expected to settle at 1, got ${settled.value}`);
  assert.ok(Math.abs(settled.velocity) < 0.01, "expected to come to rest");
});

test("a spring overshoots before settling, which is what makes it bounce", () => {
  let spring: Spring = { value: 0, velocity: 0 };
  let peak = 0;
  for (let i = 0; i < 200; i += 1) {
    spring = step(spring, 1, 1 / 120);
    peak = Math.max(peak, spring.value);
  }
  assert.ok(peak > 1.12, `expected a pronounced overshoot, peaked at ${peak.toFixed(3)}`);
  assert.ok(peak < 1.5, `overshoot should stay tasteful, peaked at ${peak.toFixed(3)}`);
});

test("a spring at rest on its target stays put", () => {
  const spring = step({ value: 0.5, velocity: 0 }, 0.5, 1 / 120);
  assert.equal(spring.value, 0.5);
  assert.equal(spring.velocity, 0);
});

test("a long frame does not blow the spring up", () => {
  let spring: Spring = { value: 0, velocity: 0 };
  for (let i = 0; i < 60; i += 1) {
    spring = step(spring, 1, 0.5);
    assert.ok(Number.isFinite(spring.value), "spring diverged");
    assert.ok(Math.abs(spring.value) < 3, `spring exploded to ${spring.value}`);
  }
  assert.ok(Math.abs(spring.value - 1) < 0.01, "should still reach the target");
});
