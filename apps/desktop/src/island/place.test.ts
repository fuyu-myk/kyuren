import assert from "node:assert/strict";
import { test } from "node:test";
import { AWAY, freshly, moveFace, placeOf, REACH, RESTING, RISE, type FaceMotion, type Place } from "./place.ts";

function play(m: FaceMotion, to: Place, seconds: number): FaceMotion {
  let at = m;
  for (let t = 0; t < seconds; t += 1 / 60) at = moveFace(at, to, 1 / 60);
  return at;
}

test("the icosahedron is in the middle of the voice tab once the island has grown, until a chat starts", () => {
  assert.equal(placeOf({ open: true, ready: true, tab: "voice", chatting: false }), "center");
  assert.equal(placeOf({ open: true, ready: false, tab: "voice", chatting: false }), "gone", "not before the island has grown");
  assert.equal(placeOf({ open: false, ready: false, tab: "voice", chatting: false }), "gone");
  assert.equal(placeOf({ open: true, ready: true, tab: "work", chatting: false }), "aside");
  assert.equal(placeOf({ open: true, ready: true, tab: "voice", chatting: true }), "above");
});

test("it appears where it stands rather than travelling there", () => {
  const first = moveFace(RESTING, "center", 1 / 60);
  assert.equal(first.x.value, 0);
  assert.equal(first.y.value, 0);
  assert.ok(play(first, "center", 1).alpha > 0.98);
});

test("another tab sweeps it all the way out of the island, whole, and coming back sweeps it in", () => {
  let m = play(RESTING, "center", 1);
  let last = 0;
  for (let t = 0; t < 1; t += 1 / 60) {
    m = moveFace(m, "aside", 1 / 60);
    assert.ok(m.x.value <= last + 0.01, "always moving away, never back");
    if (m.x.value > -REACH) assert.equal(m.alpha, 1, `still in the island at ${m.x.value.toFixed(0)}, it does not fade`);
    last = m.x.value;
  }
  assert.ok(m.x.value < -REACH && m.alpha < 0.01, `out at ${m.x.value.toFixed(0)}, alpha ${m.alpha.toFixed(2)}`);
  const turning = moveFace(m, "center", 1 / 60);
  assert.ok(turning.x.value < -REACH && turning.alpha === 1, "it sweeps back in from beyond the edge, whole");
  const back = play(turning, "center", 1);
  assert.ok(Math.abs(back.x.value) < 0.5 && back.alpha === 1);
});

test("a chat starting sends it up and away", () => {
  const m = play(play(RESTING, "center", 1), "above", 1);
  assert.ok(m.y.value < -RISE * 0.95 && m.alpha < 0.02);
  assert.ok(Math.abs(m.x.value) < 0.5);
});

test("opening on another tab, it waits out of sight where it will come from", () => {
  const m = moveFace(RESTING, "aside", 1 / 60);
  assert.equal(m.x.value, -AWAY);
  assert.ok(m.alpha < 0.01);
});

test("only a fresh appearance spins it in, and only a visible one collapses", () => {
  assert.equal(freshly("gone", "center", 0), "appear");
  assert.equal(freshly("above", "center", 0), "appear", "the voice hotkey brings it back with its turn");
  assert.equal(freshly("aside", "center", 0), null, "coming back from another tab slides it in instead");
  assert.equal(freshly("center", "gone", 1), "dismiss");
  assert.equal(freshly("aside", "gone", 0), null, "out of sight, it has nothing to collapse");
  assert.equal(freshly("center", "center", 1), null);
});
