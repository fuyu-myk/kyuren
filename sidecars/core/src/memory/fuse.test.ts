import assert from "node:assert/strict";
import { test } from "node:test";
import { cosine, fuse } from "#memory/fuse.ts";

function ranked(...ids: string[]) {
  return ids.map((id, index) => ({ id, score: 1 - index / 10 }));
}

test("what both searches like comes first", () => {
  const byMeaning = ranked("b", "a", "c");
  const byWords = ranked("c", "b", "a");
  assert.equal(fuse(byMeaning, byWords)[0]?.id, "b",
    "agreed-upon second places beat a single first place");
});

test("something only one search found still appears", () => {
  const fused = fuse(ranked("a", "b"), ranked("c"));
  assert.deepEqual(fused.map((one) => one.id).sort(), ["a", "b", "c"]);
});

test("a search that returned nothing does not erase the other", () => {
  assert.deepEqual(fuse(ranked("a", "b"), []).map((one) => one.id), ["a", "b"]);
  assert.deepEqual(fuse([], []), []);
});

test("scores are not compared across searches, only order", () => {
  // The first list is scored in the thousands, the second in fractions. If the numbers mattered
  // the first would win outright; it must not.
  const loud = [{ id: "a", score: 9000 }, { id: "b", score: 8000 }];
  const quiet = [{ id: "b", score: 0.2 }, { id: "a", score: 0.1 }];
  assert.equal(fuse(loud, quiet).length, 2);
  assert.ok(Math.abs((fuse(loud, quiet)[0]?.score ?? 0) - (fuse(loud, quiet)[1]?.score ?? 0)) < 1e-9,
    "the same pair of ranks either way round must tie");
});

test("ties break the same way every time", () => {
  assert.deepEqual(fuse(ranked("b", "a")).map((one) => one.id), ["b", "a"]);
  assert.deepEqual(fuse(ranked("a"), ranked("b")).map((one) => one.id), ["a", "b"]);
});

test("cosine knows the same direction from a different one", () => {
  const a = new Float32Array([1, 0, 0]);
  const b = new Float32Array([1, 0, 0]);
  const c = new Float32Array([0, 1, 0]);
  assert.ok(Math.abs(cosine(a, b) - 1) < 1e-6);
  assert.ok(Math.abs(cosine(a, c)) < 1e-6);
  assert.equal(cosine(a, new Float32Array([0, 0, 0])), 0, "nothing is not similar to anything");
});

test("cosine ignores how long the vectors are", () => {
  const small = new Float32Array([1, 2, 3]);
  const large = new Float32Array([10, 20, 30]);
  assert.ok(Math.abs(cosine(small, large) - 1) < 1e-6);
});
