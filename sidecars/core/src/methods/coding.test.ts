import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test("an answer that is no answer at all hands its question back, as one that does not fit would", async () => {
  const given: Array<[string, unknown]> = [];
  const hooks = { answer: (id: string, answer: unknown) => (given.push([id, answer]), true) } as unknown as HookListener;
  const answer = codingHandlers({} as CodingWatch, hooks, "/nowhere/kyuren", "/nowhere/home")["coding.answer"];
  assert.deepEqual(await answer({ id: "q1", decision: "allow", content: { title: "x".repeat(2_001) } }), { answered: false });
  assert.deepEqual(given, [["q1", { decision: "ask" }]]);
  assert.deepEqual(await answer({ id: "q2", decision: "allow" }), { answered: true });
});

test("a Claude app session resting between uses has no process, and is said to be in the app instead", async () => {
  const watch = { list: () => [{ id: "s2", harness: "claude", project: "kyuren", state: "idle", active: 0, via: "the desktop app" }] } as unknown as CodingWatch;
  const where = codingHandlers(watch, {} as HookListener, "/nowhere/kyuren", "/nowhere/home")["coding.where"];
  assert.deepEqual(await where({ session: "s2" }), { pid: null, app: "claude" });
});

test("a Claude app session is opened by the app's own link to it, running or resting, when the app keeps one", async () => {
  const home = await mkdtemp(join(tmpdir(), "kyuren-home-"));
  const kept = join(home, "Library", "Application Support", "Claude", "claude-code-sessions", "a", "b");
  await mkdir(kept, { recursive: true });
  const local = "local_a08a89ff-b82d-4937-8053-f79500215283";
  await writeFile(join(kept, `${local}.json`), JSON.stringify({ sessionId: local, cliSessionId: "s3", isArchived: false }));
  const watch = { list: () => [{ id: "s3", harness: "claude", project: "kyuren", state: "working", active: 0, via: "the desktop app", pid: 4243 }] } as unknown as CodingWatch;
  const where = codingHandlers(watch, {} as HookListener, "/nowhere/kyuren", home)["coding.where"];
  assert.deepEqual(await where({ session: "s3" }), { pid: 4243, app: "claude", link: `claude://claude.ai/epitaxy/${local}` });
});
