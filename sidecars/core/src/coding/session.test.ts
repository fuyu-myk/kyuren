import assert from "node:assert/strict";
import { test } from "node:test";
import { ordered, type Coding } from "#coding/session.ts";

const one = (id: string, state: Coding["state"], active: number): Coding => ({ id, harness: "claude", project: id, state, active });

test("what waits on the user comes first, then what is working, then the rest, newest first", () => {
  const sessions = [one("idle-new", "idle", 50), one("work-old", "working", 10), one("wait", "waiting", 5), one("work-new", "working", 40), one("idle-old", "idle", 1)];
  assert.deepEqual(ordered(sessions).map((s) => s.id), ["wait", "work-new", "work-old", "idle-new", "idle-old"]);
});
