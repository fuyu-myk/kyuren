import assert from "node:assert/strict";
import { test } from "node:test";
import {
  coast,
  drift,
  FURTHEST,
  LEAST_TILT,
  look,
  MOST_TILT,
  reach,
  NEAREST,
  spun,
  START,
  tipped,
  toward,
  zoomed,
} from "./space.ts";

const size = { width: 1000, height: 600 };
const middle = { x: 0, y: 0, lift: 0 };

test("the middle of the whirlpool is the middle of the canvas", () => {
  for (const camera of [START, spun(START, 2), tipped(START, 0.4), zoomed(START, 2)]) {
    const seen = look(middle, camera, size);
    assert.ok(Math.abs(seen.x - size.width / 2) < 1e-9);
    assert.ok(Math.abs(seen.y - size.height / 2) < 1e-9);
  }
});

test("the near arm is larger than the far one", () => {
  const front = look({ x: 0, y: -400, lift: 0 }, START, size);
  const back = look({ x: 0, y: 400, lift: 0 }, START, size);

  assert.ok(front.near > 1 && back.near < 1, "without perspective there is no depth to read");
  assert.ok(front.depth > back.depth, "what is in front must be drawn over what is behind");
  assert.ok(front.y > size.height / 2, "the near arm sits low, as a tilted surface does");
  assert.ok(back.y < size.height / 2);
});

test("turning a whole circle comes back to the same place", () => {
  const whole = look({ x: 300, y: 120, lift: -40 }, START, size);
  const round = look({ x: 300, y: 120, lift: -40 }, spun(START, Math.PI * 2), size);
  assert.ok(Math.abs(whole.x - round.x) < 1e-6);
  assert.ok(Math.abs(whole.y - round.y) < 1e-6);
});

test("the axis of the turn holds still while everything else moves", () => {
  const axis = { x: 0, y: 0, lift: 260 };
  const still = look(axis, START, size);
  for (const by of [0.4, 1.9, 3.3]) {
    const turned = look(axis, spun(START, by), size);
    assert.ok(Math.abs(turned.x - still.x) < 1e-9, "the middle of a whirlpool does not swing");
    assert.ok(Math.abs(turned.y - still.y) < 1e-9);
  }
});

test("the eye stays above the surface and never inside it", () => {
  let camera = START;
  for (let at = 0; at < 60; at += 1) camera = tipped(camera, 0.2);
  assert.equal(camera.tilt, MOST_TILT);

  for (let at = 0; at < 60; at += 1) camera = tipped(camera, -0.2);
  assert.equal(camera.tilt, LEAST_TILT, "edge on there is nothing left to look at");
});

test("zoom stops rather than going on forever", () => {
  let camera = START;
  for (let at = 0; at < 60; at += 1) camera = zoomed(camera, 1.4);
  assert.equal(camera.zoom, NEAREST);

  for (let at = 0; at < 120; at += 1) camera = zoomed(camera, 0.7);
  assert.equal(camera.zoom, FURTHEST);
});

test("a spun camera never runs out of angle", () => {
  let camera = START;
  for (let at = 0; at < 60 * 60 * 24; at += 1) camera = drift(camera, 1);
  assert.ok(camera.spin >= 0 && camera.spin < Math.PI * 2);
});

test("a flick keeps turning and then stops", () => {
  let camera = START;
  let speed = 0.05;
  let steps = 0;

  while (speed !== 0) {
    ({ camera, speed } = coast(camera, speed));
    steps += 1;
    assert.ok(steps < 500, "momentum that never stops is a graph that never settles");
  }
  assert.ok(steps > 5, "stopping at once is not momentum");
  assert.ok(camera.spin > 0.1, "it carried on in the direction of the flick");
});

test("a value eased towards another arrives and stays", () => {
  let at = 0;
  for (let step = 0; step < 400; step += 1) at = toward(at, 300, 1 / 60, 6);
  assert.ok(Math.abs(at - 300) < 1e-6);
});

test("easing does not depend on how often the frames come", () => {
  let quick = 0;
  let slow = 0;
  for (let step = 0; step < 120; step += 1) quick = toward(quick, 400, 1 / 120, 6);
  for (let step = 0; step < 30; step += 1) slow = toward(slow, 400, 1 / 30, 6);

  assert.ok(Math.abs(quick - slow) < 1, "a slow machine must not settle somewhere else");
});

test("a point on the canvas reaches back to the place it came from", () => {
  for (const camera of [START, spun(START, 1.1), tipped(START, 0.5), zoomed(START, 1.7)]) {
    for (const spot of [
      { x: 300, y: -120, lift: 40 },
      { x: -260, y: 380, lift: 0 },
      { x: 90, y: 40, lift: 120 },
    ]) {
      const back = reach(look(spot, camera, size), spot.lift, camera, size);
      assert.ok(back, "an orb that cannot be reached cannot be taken hold of");
      assert.ok(Math.abs(back.x - spot.x) < 1e-6, `${back.x} against ${spot.x}`);
      assert.ok(Math.abs(back.y - spot.y) < 1e-6, `${back.y} against ${spot.y}`);
    }
  }
});

