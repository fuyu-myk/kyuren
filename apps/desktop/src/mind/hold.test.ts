import assert from "node:assert/strict";
import { test } from "node:test";
import { Holding, LET_GO, raised } from "./hold.ts";
import type { Grip, Reading } from "./reach.ts";

function seen(grip: Grip, other?: Grip): Reading {
  const one = (which: Grip): Reading => ({ x: 0.5, y: 0.5, hand: [], grip: which, pinch: 0 });
  return other ? { ...one(grip), other: one(other) } : one(grip);
}

test("only the other hand's raised finger holds, whatever the aiming hand does", () => {
  assert.equal(raised(seen("point")), false, "the aiming hand pointing is aiming, not holding");
  assert.equal(raised(seen("open", "one")), true);
  assert.equal(raised(seen("pinch", "point")), true, "a point is the same finger up with the thumb tucked in");
  assert.equal(raised(seen("open", "open")), false);
  assert.equal(raised(undefined), false);
});

test("a hold engages at once, survives a few doubtful readings, and lifts when the finger stays down", () => {
  const holding = new Holding();
  assert.equal(holding.saw(seen("open", "one")), true);
  for (let doubt = 1; doubt < LET_GO; doubt += 1) {
    assert.equal(holding.saw(seen("open", "open")), true, `still held after ${doubt} doubtful readings`);
  }
  assert.equal(holding.saw(seen("open", "open")), false, "and then let go");
  assert.equal(holding.holds, false);
});

test("a doubtful reading in the middle of holding does not shorten the hold", () => {
  const holding = new Holding();
  holding.saw(seen("open", "one"));
  for (let doubt = 1; doubt < LET_GO; doubt += 1) holding.saw(seen("open", "open"));
  holding.saw(seen("open", "one"));
  for (let doubt = 1; doubt < LET_GO; doubt += 1) {
    assert.equal(holding.saw(seen("open", "open")), true);
  }
});

test("no hand in view lifts the hold at once", () => {
  const holding = new Holding();
  holding.saw(seen("open", "one"));
  assert.equal(holding.saw(undefined), false);
  assert.equal(holding.holds, false);
});
