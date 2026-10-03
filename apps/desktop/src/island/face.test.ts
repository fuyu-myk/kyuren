import assert from "node:assert/strict";
import { test } from "node:test";
import { presence } from "./appear.ts";
import { atRest, FACE, stepFace, type Face } from "./face.ts";
import type { Place } from "./place.ts";

function play(face: Face, to: Place, voice: Parameters<typeof stepFace>[2], seconds: number): Face {
  let at = face;
  for (let t = 0; t < seconds; t += 1 / 60) at = stepFace(at, to, voice, 0, 1 / 60);
  return at;
}

test("appearing, it spins in and settles whole", () => {
  const first = stepFace(FACE, "center", "idle", 0, 1 / 60);
  assert.equal(first.transition?.kind, "appear");
  assert.ok(presence(first.transition, first.t) < 0.5);
  const later = play(first, "center", "idle", 0.6);
  assert.equal(presence(later.transition, later.t), 1);
});

test("shown, it never rests; put away and faded, it does", () => {
  const shown = play(FACE, "center", "idle", 2);
  assert.equal(atRest(shown), false, "an icosahedron on show is always alive");
  assert.equal(atRest(play(shown, "gone", "idle", 1)), true);
  assert.equal(atRest(play(shown, "aside", "idle", 1)), true);
  assert.equal(atRest(FACE), true, "before it was ever shown it costs nothing");
});

test("it turns faster while thinking than while at rest", () => {
  const resting = play(FACE, "center", "idle", 1);
  const thinking = play(FACE, "center", "thinking", 1);
  assert.ok(thinking.clock > resting.clock * 1.5, `${thinking.clock.toFixed(2)} against ${resting.clock.toFixed(2)}`);
});

test("folded away and opened on another tab, it still comes back on the voice tab", () => {
  let f = play(FACE, "center", "idle", 1);
  f = play(f, "gone", "idle", 1);
  f = play(f, "aside", "idle", 0.5);
  f = play(f, "center", "idle", 1);
  assert.equal(presence(f.transition, f.t), 1, "a collapse long over no longer holds it at nothing");
  assert.ok(f.motion.alpha > 0.98);
});
