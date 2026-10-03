import assert from "node:assert/strict";
import { test } from "node:test";
import { toldOf, type Finished } from "./done.ts";

const finished = (outcome: Finished["outcome"], worked = 95_000): Finished => ({ session: "s1", project: "kyuren", worked, outcome });

test("a turn's end is told in a line: its tests, then the files it changed", () => {
  assert.deepEqual(toldOf(finished({ tests: { passed: 39, failed: 0, ok: true }, files: 3 })), { who: "kyuren finished", how: "39 passed · 3 files changed", state: "healthy" });
  assert.deepEqual(toldOf(finished({ tests: { passed: 38, failed: 2, ok: false }, files: 1 })), { who: "kyuren finished", how: "2 failed · 1 file changed", state: "failed" });
  assert.deepEqual(toldOf(finished({ tests: { passed: null, failed: null, ok: false }, files: 0 })), { who: "kyuren finished", how: "tests failed", state: "failed" });
});

test("with nothing to count, or nothing read, it says how long the turn worked", () => {
  assert.equal(toldOf(finished({ tests: null, files: 0 })).how, "after 2 minutes");
  assert.equal(toldOf(finished(null, 40_000)).how, "after 40 seconds");
  assert.equal(toldOf(finished(null, 60_000)).how, "after a minute");
  assert.equal(toldOf(finished(null)).state, null);
});
