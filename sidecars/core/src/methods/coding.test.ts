import assert from "node:assert/strict";
import { test } from "node:test";
import type { HookListener } from "#coding/hooks.ts";
import type { CodingWatch } from "#coding/watch.ts";
import { codingHandlers } from "#methods/coding.ts";

test("where a session runs is told only of a session the watch knows to be running", async () => {
  const watch = { list: () => [{ id: "s1", harness: "claude", project: "kyuren", state: "idle", active: 0, pid: 4242 }] } as unknown as CodingWatch;
  const where = codingHandlers(watch, {} as HookListener, "/nowhere/kyuren", "/nowhere/home")["coding.where"];
  assert.deepEqual(await where({ session: "s1" }), { pid: 4242 });
  assert.deepEqual(await where({ session: "s2" }), { pid: null }, "a session merely named");
  assert.deepEqual(await where({ session: 4242 }), { pid: null });
});
