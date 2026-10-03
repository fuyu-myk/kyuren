import assert from "node:assert/strict";
import { test } from "node:test";
import { crowding, orbScale, roomFor } from "./crowd.ts";

test("a small mind is not a crowd, and a thousand is as crowded as it gets", () => {
  assert.equal(crowding(30), 0);
  assert.equal(crowding(1000), 1);
  const between = crowding(400);
  assert.ok(between > 0 && between < 1);
  assert.ok(crowding(600) > between, "more orbs, more crowd");
});

test("a crowd gets smaller orbs and more room", () => {
  assert.equal(orbScale(0), 1, "a small mind is drawn as it always was");
  assert.equal(roomFor(0), 1);
  assert.ok(orbScale(1) <= 0.5, "at a thousand an orb is half its size or less");
  assert.ok(roomFor(1) > 1 && roomFor(1) < 1.4, "more of the screen, but still on it");
});
