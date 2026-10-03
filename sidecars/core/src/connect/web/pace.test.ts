import assert from "node:assert/strict";
import { test } from "node:test";
import { spaced } from "#connect/web/pace.ts";

test("spaced work goes one at a time, a gap apart, in the order asked, and a failure holds nothing up", async () => {
  const search = spaced(40);
  const began = Date.now();
  const finished: number[] = [];
  const results = await Promise.all([
    search(async () => { finished.push(Date.now() - began); return "a"; }),
    search(async () => { finished.push(Date.now() - began); throw new Error("challenged"); }).catch((failure: Error) => failure.message),
    search(async () => { finished.push(Date.now() - began); return "c"; }),
  ]);
  assert.deepEqual(results, ["a", "challenged", "c"]);
  assert.ok(finished[1]! - finished[0]! >= 35, `second waited ${finished[1]! - finished[0]!} ms`);
  assert.ok(finished[2]! - finished[1]! >= 35, `third waited ${finished[2]! - finished[1]!} ms`);
});
