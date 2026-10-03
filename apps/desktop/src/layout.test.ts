import assert from "node:assert/strict";
import { test } from "node:test";
import { arranged, slot } from "./layout.ts";

test("dragged within what is shown, a thing moves to where it is let go", () => {
  assert.deepEqual(arranged(["a", "b", "c"], "a", "shown", 2), ["b", "c", "a"]);
  assert.deepEqual(arranged(["a", "b", "c"], "c", "shown", 0), ["c", "a", "b"]);
  assert.deepEqual(arranged(["a", "b", "c"], "b", "shown", 1), ["a", "b", "c"], "let go where it was, nothing changes");
});

test("dragged in from the hidden ones it is shown where it is let go, and dragged out it is hidden", () => {
  assert.deepEqual(arranged(["a", "c"], "b", "shown", 1), ["a", "b", "c"]);
  assert.deepEqual(arranged(["a", "c"], "b", "shown", 9), ["a", "c", "b"], "past the end is the end");
  assert.deepEqual(arranged(["a", "b", "c"], "b", "hidden", 0), ["a", "c"]);
});

test("a place is found by which halves of the things the pointer is past", () => {
  const boxes = [{ left: 0, width: 40 }, { left: 50, width: 40 }, { left: 100, width: 40 }];
  assert.equal(slot(5, boxes), 0);
  assert.equal(slot(25, boxes), 1, "past the middle of the first, after it");
  assert.equal(slot(95, boxes), 2);
  assert.equal(slot(400, boxes), 3, "past them all, at the end");
  assert.equal(slot(10, []), 0);
});
