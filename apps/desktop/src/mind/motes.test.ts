import assert from "node:assert/strict";
import { test } from "node:test";
import { BORN, LIFE, MOTES, TRAVEL, motesAt } from "./motes.ts";

test("there are always as many motes, all between the rim and the edge of the light", () => {
  for (const moment of [0, 0.4, 2.9, 17.3, 1000.5]) {
    const motes = motesAt(moment);
    assert.equal(motes.length, MOTES);
    for (const mote of motes) {
      assert.ok(mote.far >= BORN - 1e-9, `${mote.far} starts inside the frame`);
      assert.ok(mote.far <= BORN + TRAVEL * 1.5, `${mote.far} is out past the light`);
      assert.ok(mote.alpha >= 0 && mote.alpha <= 1);
      assert.ok(mote.size > 0);
    }
  }
});

test("a mote sets off from the rim faint, is soon bright, and is gone by the end of its life", () => {
  const born = motesAt(0)[0]!;
  assert.ok(Math.abs(born.far - BORN) < 1e-9, "it is born on the rim");
  assert.ok(born.alpha < 0.05, "it does not pop into being");

  const young = motesAt(0.3)[0]!;
  assert.ok(young.alpha > 0.5, "it is soon plainly there");
  assert.ok(young.far > BORN, "and on its way out");

  const old = motesAt(LIFE - 0.001)[0]!;
  assert.ok(old.alpha < 0.01, `${old.alpha} has not faded out`);
  assert.ok(old.far > BORN + TRAVEL * 0.6, "it fades far from the frame, not beside it");
  assert.ok(old.size < young.size, "it dwindles as it goes");
});

test("a mote born again goes another way", () => {
  const first = motesAt(0.1)[0]!;
  const again = motesAt(LIFE + 0.1)[0]!;
  assert.notEqual(first.angle, again.angle);
  assert.ok(Math.abs(first.alpha - again.alpha) < 1e-9, "at the same age it is as bright");
});

test("the motes are spread across their lives rather than pulsing together", () => {
  const motes = motesAt(0);
  const fars = motes.map((mote) => mote.far);
  assert.ok(Math.max(...fars) - Math.min(...fars) > TRAVEL * 0.5);
  assert.ok(new Set(motes.map((mote) => mote.alpha.toFixed(3))).size > MOTES / 2);
});

test("the same moment always gives the same motes", () => {
  assert.deepEqual(motesAt(4.2), motesAt(4.2));
});
