import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Coding, State } from "#coding/session.ts";
import { MIN_TURN, Turns } from "#coding/turns.ts";

const session = (state: State, id = "s1", harness = "claude"): Coding => ({ id, harness, project: "kyuren", state, active: 0 }) as Coding;
let n = 0;
const use = (name: string, input: object) => {
  n += 1;
  return { id: `t${n}`, line: `${JSON.stringify({ type: "assistant", cwd: "/x", message: { content: [{ type: "tool_use", id: `t${n}`, name, input }] } })}\n` };
};
const answer = (id: string, toolUseResult: object) =>
  `${JSON.stringify({ type: "user", cwd: "/x", message: { content: [{ type: "tool_result", tool_use_id: id, content: "", is_error: false }] }, toolUseResult })}\n`;

function projects(): { root: string; file: string } {
  const root = mkdtempSync(join(tmpdir(), "kyuren-projects-"));
  mkdirSync(join(root, "-x"));
  const file = join(root, "-x", "s1.jsonl");
  const before = use("Read", { file_path: "/x/old.ts" });
  writeFileSync(file, before.line + answer(before.id, { type: "text", file: { filePath: "/x/old.ts", content: "", numLines: 0, startLine: 1, totalLines: 0 } }));
  return { root, file };
}

test("a turn that worked a while ends with how it went, read from what it wrote in that turn alone", async () => {
  const { root, file } = projects();
  const turns = new Turns(root);
  assert.deepEqual(await turns.seen([session("idle")], 0), []);
  assert.deepEqual(await turns.seen([session("working")], 1_000), []);
  const edit = use("Edit", { file_path: "/x/a.ts" });
  const run = use("Bash", { command: "cargo test" });
  appendFileSync(file, edit.line + answer(edit.id, { filePath: "/x/a.ts", structuredPatch: [] }) + run.line + answer(run.id, { stdout: "test result: ok. 39 passed; 0 failed", stderr: "" }));
  assert.deepEqual(await turns.seen([session("waiting")], 20_000), [], "waiting is the same turn");
  assert.deepEqual(await turns.seen([session("working")], 25_000), []);
  const ended = await turns.seen([session("idle")], 1_000 + MIN_TURN + 5_000);
  assert.deepEqual(ended, [{ session: "s1", project: "kyuren", worked: MIN_TURN + 5_000, outcome: { tests: { passed: 39, failed: 0, ok: true }, files: 1 } }]);
});

test("a short turn, an agent the transcripts of which are not read, and a session gone say nothing", async () => {
  const { root } = projects();
  const turns = new Turns(root);
  await turns.seen([session("idle"), session("idle", "c1", "codex")], 0);
  await turns.seen([session("working"), session("working", "c1", "codex")], 1_000);
  assert.deepEqual(await turns.seen([session("idle"), session("idle", "c1", "codex")], 5_000), [], "a quick answer, watched as it came");
  await turns.seen([session("working")], 10_000);
  assert.deepEqual(await turns.seen([], 10_000 + MIN_TURN + 1), [], "ended by leaving, not by finishing");
});

test("a turn already under way when watching began ends from where it was first seen, and one with no transcript ends without an outcome", async () => {
  const { root, file } = projects();
  const turns = new Turns(root);
  await turns.seen([session("working"), session("working", "ghost")], 0);
  const run = use("Bash", { command: "pnpm test" });
  appendFileSync(file, run.line + answer(run.id, { stdout: "ℹ pass 3\nℹ fail 1", stderr: "" }));
  const ended = await turns.seen([session("idle"), session("idle", "ghost")], MIN_TURN + 1);
  assert.deepEqual(
    ended.map((one) => [one.session, one.outcome]),
    [["s1", { tests: { passed: 3, failed: 1, ok: false }, files: 0 }], ["ghost", null]],
  );
});
