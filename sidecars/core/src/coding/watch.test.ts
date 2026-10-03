import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Ask } from "#coding/asked.ts";
import { MIN_TURN } from "#coding/turns.ts";
import { CodingWatch } from "#coding/watch.ts";
import type { Outbound } from "#protocol.ts";

test("the island is told of the sessions once, and again only when one of them changes", async () => {
  const home = await mkdtemp(join(tmpdir(), "kyuren-home-"));
  const registry = join(home, ".claude", "sessions");
  await mkdir(registry, { recursive: true });
  const write = (status: string) => writeFile(join(registry, "501.json"), JSON.stringify({
    pid: 501, sessionId: "s1", cwd: "/x/kyuren", status, statusUpdatedAt: Date.now(),
  }));
  const sent: Outbound[] = [];
  const watch = new CodingWatch({ send: (message) => sent.push(message), listen: () => {} }, home, async () => true);

  await write("busy");
  await watch.refresh();
  await watch.refresh();
  assert.equal(sent.length, 1, "nothing changed the second time");
  assert.deepEqual(watch.list().map((one) => [one.id, one.state]), [["s1", "working"]]);

  await write("waiting");
  await watch.refresh();
  assert.equal(sent.length, 2);
  assert.equal((sent[1] as { data: { sessions: Array<{ state: string }> } }).data.sessions[0]?.state, "waiting");
});

test("a session that has ended is not brought back by its transcript", async () => {
  const home = await mkdtemp(join(tmpdir(), "kyuren-home-"));
  const registry = join(home, ".claude", "sessions");
  const transcripts = join(home, ".claude", "projects", "-x-kyuren");
  await mkdir(registry, { recursive: true });
  await mkdir(transcripts, { recursive: true });
  await writeFile(join(registry, "701.json"), JSON.stringify({ pid: 701, sessionId: "s7", cwd: "/x/kyuren", status: "busy", statusUpdatedAt: Date.now() }));
  let alive = true;
  const watch = new CodingWatch({ send: () => {}, listen: () => {} }, home, async () => alive);
  await watch.refresh();
  assert.deepEqual(watch.list().map((one) => one.id), ["s7"]);
  alive = false;
  await writeFile(join(transcripts, "s7.jsonl"), "{}");
  watch.saw(join(transcripts, "s7.jsonl"), Date.now());
  await watch.refresh();
  assert.deepEqual(watch.list(), [], "ended, it is gone, though its transcript was just written");
});

test("a session whose question is on the island is shown waiting for that permission", async () => {
  const home = await mkdtemp(join(tmpdir(), "kyuren-home-"));
  const registry = join(home, ".claude", "sessions");
  await mkdir(registry, { recursive: true });
  await writeFile(join(registry, "801.json"), JSON.stringify({ pid: 801, sessionId: "s8", cwd: "/x/kyuren", status: "busy", statusUpdatedAt: Date.now() }));
  let asks: Ask[] = [];
  const watch = new CodingWatch({ send: () => {}, listen: () => {} }, home, async () => true, () => asks);
  await watch.refresh();
  assert.deepEqual(watch.list().map((one) => [one.state, one.waitingFor]), [["working", undefined]]);
  asks = [{ id: "a", harness: "claude", session: "s8", project: "kyuren", tool: "Bash", verb: "run", target: "make", at: 0, until: 1 }];
  await watch.refresh();
  assert.deepEqual(watch.list().map((one) => [one.state, one.waitingFor]), [["waiting", "permission to run"]]);
});

test("a turn that ends after working a while is told of once, with how it went", async () => {
  const home = await mkdtemp(join(tmpdir(), "kyuren-home-"));
  const registry = join(home, ".claude", "sessions");
  const transcripts = join(home, ".claude", "projects", "-x-kyuren");
  await mkdir(registry, { recursive: true });
  await mkdir(transcripts, { recursive: true });
  const record = (status: string) => writeFile(join(registry, "901.json"), JSON.stringify({ pid: 901, sessionId: "s9", cwd: "/x/kyuren", status, statusUpdatedAt: 0 }));
  await writeFile(join(transcripts, "s9.jsonl"), "");
  const sent: Outbound[] = [];
  let clock = 0;
  const watch = new CodingWatch({ send: (message) => sent.push(message), listen: () => {} }, home, async () => true, () => [], () => clock);

  await record("idle");
  await watch.refresh();
  await record("busy");
  clock = 1_000;
  await watch.refresh();
  const edit = { type: "assistant", cwd: "/x/kyuren", message: { content: [{ type: "tool_use", id: "e1", name: "Edit", input: { file_path: "/x/kyuren/a.ts" } }] } };
  const edited = { type: "user", cwd: "/x/kyuren", message: { content: [{ type: "tool_result", tool_use_id: "e1", content: "", is_error: false }] }, toolUseResult: { filePath: "/x/kyuren/a.ts", structuredPatch: [] } };
  await writeFile(join(transcripts, "s9.jsonl"), `${JSON.stringify(edit)}\n${JSON.stringify(edited)}\n`);
  await record("idle");
  clock = 1_000 + MIN_TURN;
  await watch.refresh();
  await watch.refresh();

  const told = sent.filter((message) => (message as { event?: string }).event === "coding.done").map((message) => (message as { data: unknown }).data);
  assert.deepEqual(told, [{ session: "s9", project: "kyuren", worked: MIN_TURN, outcome: { tests: null, files: 1 } }]);
});
