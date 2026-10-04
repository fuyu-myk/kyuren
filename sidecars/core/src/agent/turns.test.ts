import assert from "node:assert/strict";
import { test } from "node:test";
import { Turns } from "#agent/turns.ts";

test("a turn begun under a name already in use stops the one before it", () => {
  const turns = new Turns();
  const first = turns.begin("default");
  const second = turns.begin("default");
  assert.equal(first.signal.aborted, true);
  assert.equal(second.signal.aborted, false);
});

test("a turn that ends lets go of its name only while it still holds it, so a newer one can still be stopped", () => {
  const turns = new Turns();
  const first = turns.begin("default");
  const second = turns.begin("default");
  turns.end("default", first);
  assert.equal(turns.stop("default"), true);
  assert.equal(second.signal.aborted, true);
});

test("stopping a name nothing is running under stops nothing", () => {
  const turns = new Turns();
  assert.equal(turns.stop("nobody"), false);
  const one = turns.begin("chat:1");
  turns.end("chat:1", one);
  assert.equal(turns.stop("chat:1"), false);
  assert.equal(one.signal.aborted, false);
});
