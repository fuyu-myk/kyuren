import assert from "node:assert/strict";
import { test } from "node:test";
import {
  APPEAR_SECONDS,
  DISMISS_SECONDS,
  presence,
  spinOffset,
  type Transition,
} from "./appear.ts";

const TURN = Math.PI * 2;
const appear: Transition = { kind: "appear", at: 0 };
const dismiss: Transition = { kind: "dismiss", at: 0 };

function sweep(transition: Transition, span: number, from: number, to: number): number {
  return Math.abs(spinOffset(transition, to * span) - spinOffset(transition, from * span));
}

test("spawning sweeps exactly one full turn", () => {
  assert.equal(spinOffset(appear, 0), -TURN);
  assert.equal(Math.abs(spinOffset(appear, APPEAR_SECONDS)), 0);
});

test("spawning spins fast then settles", () => {
  const first = sweep(appear, APPEAR_SECONDS, 0, 0.2);
  const last = sweep(appear, APPEAR_SECONDS, 0.8, 1);

  assert.ok(
    first > last * 8,
    `the opening fifth should dominate the closing fifth, got ${first.toFixed(3)} against ${last.toFixed(3)}`,
  );
  assert.ok(first > TURN * 0.4, "the first fifth should cover a large part of the turn");
});

test("dismissing also sweeps a full turn, accelerating", () => {
  assert.equal(spinOffset(dismiss, 0), 0);
  assert.equal(spinOffset(dismiss, DISMISS_SECONDS), TURN);

  const first = sweep(dismiss, DISMISS_SECONDS, 0, 0.2);
  const last = sweep(dismiss, DISMISS_SECONDS, 0.8, 1);
  assert.ok(last > first * 3, "dismissal should accelerate into the collapse");
});

test("a settled icosahedron has no spin offset", () => {
  assert.equal(spinOffset(null, 1.23), 0);
});

test("spawning overshoots then settles to exactly one", () => {
  const peak = Math.max(
    ...Array.from({ length: 50 }, (_, i) => presence(appear, (i / 49) * APPEAR_SECONDS)),
  );
  assert.ok(peak > 1, `expected an overshoot above one, got ${peak.toFixed(3)}`);
  assert.equal(presence(appear, APPEAR_SECONDS), 1);
});

test("dismissal ends at nothing", () => {
  assert.equal(presence(dismiss, DISMISS_SECONDS), 0);
  assert.equal(presence(dismiss, DISMISS_SECONDS * 5), 0);
});
