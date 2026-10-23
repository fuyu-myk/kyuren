import assert from "node:assert/strict";
import { test } from "node:test";
import { began, ended, repairing, stopping, watchRepairs } from "./repairs.ts";

test("a repair stays known apart from the page that began it, and is marked as stopped before the stop lands", () => {
  let told = 0;
  const unwatch = watchRepairs(() => (told += 1));
  began("weekly-review", "repair:1");
  assert.deepEqual(repairing("weekly-review"), { id: "repair:1", stopped: false });
  assert.deepEqual(stopping("weekly-review"), { id: "repair:1", stopped: true });
  assert.equal(repairing("weekly-review")?.stopped, true);
  ended("weekly-review", "repair:1");
  assert.equal(repairing("weekly-review"), undefined);
  assert.equal(told, 3, "each change is told");
  unwatch();
  assert.equal(stopping("weekly-review"), undefined, "nothing is under way to stop");
});

test("the end of one repair leaves a later repair of the same playbook alone, and others apart", () => {
  began("weekly-review", "repair:2");
  began("research", "repair:3");
  began("weekly-review", "repair:4");
  ended("weekly-review", "repair:2");
  assert.equal(repairing("weekly-review")?.id, "repair:4");
  assert.equal(repairing("research")?.id, "repair:3");
  ended("weekly-review", "repair:4");
  ended("research", "repair:3");
});
