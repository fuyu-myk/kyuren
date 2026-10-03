import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SessionDetails, transcriptOf } from "#coding/transcript.ts";

test("a session's transcript is found by its id among the projects, and nothing else is", async () => {
  const projects = mkdtempSync(join(tmpdir(), "kyuren-projects-"));
  mkdirSync(join(projects, "-Users-someone-Code-kyuren"));
  writeFileSync(join(projects, "-Users-someone-Code-kyuren", "c7e753b3-1536.jsonl"), "{}\n");
  assert.equal(await transcriptOf(projects, "c7e753b3-1536"), join(projects, "-Users-someone-Code-kyuren", "c7e753b3-1536.jsonl"));
  assert.equal(await transcriptOf(projects, "missing"), undefined);
  assert.equal(await transcriptOf(projects, "../../etc/passwd"), undefined, "an id is never a path");
});

test("an id is never a path, even to a transcript that is there", async () => {
  const home = mkdtempSync(join(tmpdir(), "kyuren-home-"));
  const projects = join(home, "projects");
  mkdirSync(join(projects, "p1"), { recursive: true });
  writeFileSync(join(home, "outside.jsonl"), "{}\n");
  assert.equal(await transcriptOf(projects, "../../outside"), undefined);
});

test("a session found in two projects, as when one was renamed, is read from where it was written last", async () => {
  const projects = mkdtempSync(join(tmpdir(), "kyuren-projects-"));
  mkdirSync(join(projects, "-x-a"));
  mkdirSync(join(projects, "-x-b"));
  writeFileSync(join(projects, "-x-a", "s.jsonl"), "{}\n");
  writeFileSync(join(projects, "-x-b", "s.jsonl"), "{}\n");
  utimesSync(join(projects, "-x-a", "s.jsonl"), new Date(2026, 0, 1), new Date(2026, 0, 1));
  assert.equal(await transcriptOf(projects, "s"), join(projects, "-x-b", "s.jsonl"));
});

const use = (n: number, name = "Bash", input: object = { command: `step ${n}` }) =>
  `${JSON.stringify({ type: "assistant", cwd: "/x", message: { content: [{ type: "tool_use", id: `t${n}`, name, input }] } })}\n`;
const answer = (n: number, toolUseResult: object, content = "") =>
  `${JSON.stringify({ type: "user", cwd: "/x", message: { content: [{ type: "tool_result", tool_use_id: `t${n}`, content, is_error: false }] }, toolUseResult })}\n`;

test("a transcript is read once and then only for what was added to it, a line still being written left for later", async () => {
  const projects = mkdtempSync(join(tmpdir(), "kyuren-projects-"));
  mkdirSync(join(projects, "-x-one"));
  const file = join(projects, "-x-one", "s1.jsonl");
  writeFileSync(file, use(1));
  const details = new SessionDetails(projects);

  const first = await details.of("s1");
  assert.deepEqual(first?.steps.map((step) => step.target), ["step 1"]);
  const again = await details.of("s1", first?.seq, first?.epoch);
  assert.deepEqual([again?.steps, again?.total], [[], 1], "nothing new");

  const half = use(2);
  appendFileSync(file, half.slice(0, 20));
  assert.deepEqual((await details.of("s1", first?.seq, first?.epoch))?.steps, [], "half a line is not read");
  appendFileSync(file, half.slice(20));
  const second = await details.of("s1", first?.seq, first?.epoch);
  assert.deepEqual(second?.steps.map((step) => step.target), ["step 2"], "only what was added");
  assert.equal(second?.epoch, first?.epoch);
  assert.deepEqual((await details.of("s1", first?.seq, "another"))?.steps.map((step) => step.target), ["step 1", "step 2"], "asked of another reading, all");
});

test("a transcript gone is looked for again, and one cut short is read afresh", async () => {
  const projects = mkdtempSync(join(tmpdir(), "kyuren-projects-"));
  mkdirSync(join(projects, "-x-one"));
  writeFileSync(join(projects, "-x-one", "s1.jsonl"), use(1) + use(2));
  const details = new SessionDetails(projects);
  const first = await details.of("s1");
  writeFileSync(join(projects, "-x-one", "s1.jsonl"), use(3));
  const cut = await details.of("s1", first?.seq, first?.epoch);
  assert.notEqual(cut?.epoch, first?.epoch);
  assert.deepEqual(cut?.steps.map((step) => step.target), ["step 3"]);

  rmSync(join(projects, "-x-one"), { recursive: true });
  assert.equal(await details.of("s1"), null, "gone");
  mkdirSync(join(projects, "-x-two"));
  writeFileSync(join(projects, "-x-two", "s1.jsonl"), use(4));
  assert.deepEqual((await details.of("s1"))?.steps.map((step) => step.target), ["step 4"], "found where it is now");
  assert.equal(await details.of("../s1"), null, "an id is never a path");
});

test("only the session the island has open is kept", async () => {
  const projects = mkdtempSync(join(tmpdir(), "kyuren-projects-"));
  mkdirSync(join(projects, "-x"));
  writeFileSync(join(projects, "-x", "a.jsonl"), use(1));
  writeFileSync(join(projects, "-x", "b.jsonl"), use(2));
  const details = new SessionDetails(projects);
  const a = await details.of("a");
  assert.equal((await details.of("a"))?.epoch, a?.epoch);
  await details.of("b");
  assert.notEqual((await details.of("a"))?.epoch, a?.epoch, "read again, since another was opened meanwhile");
});

test("a step opened is read from where it lies in the transcript", async () => {
  const projects = mkdtempSync(join(tmpdir(), "kyuren-projects-"));
  mkdirSync(join(projects, "-x"));
  writeFileSync(join(projects, "-x", "s.jsonl"), use(1) + answer(1, { stdout: "built", stderr: "" }) + use(2));
  const details = new SessionDetails(projects);
  const ran = await details.step("s", "t1");
  assert.ok(ran?.kind === "run");
  assert.deepEqual([ran.command, ran.output, ran.ok], ["step 1", ["built"], true]);
  const going = await details.step("s", "t2");
  assert.deepEqual([going?.kind, going?.ok], ["run", null]);
  assert.equal(await details.step("s", "t9"), null);
  assert.equal(await details.step("s", "../t1"), null, "a step's id is never a path");
});

test("a step handed to an agent opens to the agent's own steps, found by the step that started it", async () => {
  const projects = mkdtempSync(join(tmpdir(), "kyuren-projects-"));
  const agents = join(projects, "-x", "s", "subagents");
  mkdirSync(agents, { recursive: true });
  writeFileSync(join(projects, "-x", "s.jsonl"), use(1, "Agent", { description: "look around", prompt: "list the files" }));
  writeFileSync(join(agents, "agent-abc123.meta.json"), JSON.stringify({ agentType: "general-purpose", description: "look around", toolUseId: "t1" }));
  const aside = (line: string) => line.replace('{"type":', '{"isSidechain":true,"agentId":"abc123","type":');
  writeFileSync(join(agents, "agent-abc123.jsonl"), aside(use(7, "Bash", { command: "ls" })) + aside(answer(7, { stdout: "a.ts", stderr: "" })));
  writeFileSync(join(agents, "agent-other.meta.json"), JSON.stringify({ toolUseId: "t0" }));
  const details = new SessionDetails(projects);

  const handed = await details.step("s", "t1");
  assert.ok(handed?.kind === "agent");
  assert.deepEqual([handed.agent, handed.about, handed.ok], ["abc123", "look around", null], "still working, found by its meta");
  assert.deepEqual(handed.steps.map((step) => [step.id, step.target, step.ok]), [["t7", "ls", true]]);
  const inner = await details.step("s", "t7", "abc123");
  assert.ok(inner?.kind === "run");
  assert.deepEqual(inner.output, ["a.ts"]);
  assert.equal(await details.step("s", "t7", "../../x"), null, "an agent's id is never a path");
});

test("a line longer than a reading, cut there inside a character, is read whole, and the lines after it", async () => {
  const projects = mkdtempSync(join(tmpdir(), "kyuren-projects-"));
  mkdirSync(join(projects, "-x"));
  const head = `{"type":"assistant","cwd":"/x","message":{"content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"`;
  const command = `${"x".repeat((1 << 20) - 1 - Buffer.byteLength(head))}${"é".repeat(40_000)}`;
  writeFileSync(join(projects, "-x", "s.jsonl"), `${head}${command}"}}]}}\n${use(2)}`);
  const details = new SessionDetails(projects);
  const read = await details.of("s");
  assert.deepEqual(read?.steps.map((step) => step.id), ["t1", "t2"]);
  const long = await details.step("s", "t1");
  assert.ok(long?.kind === "run");
  assert.equal(long.command, command, "whole, every character as it was");
});

test("a transcript put in place of the one being read is read afresh", async () => {
  const projects = mkdtempSync(join(tmpdir(), "kyuren-projects-"));
  mkdirSync(join(projects, "-x"));
  writeFileSync(join(projects, "-x", "s.jsonl"), use(1) + use(2));
  const details = new SessionDetails(projects);
  const first = await details.of("s");
  writeFileSync(join(projects, "-x", "s.new"), use(3) + use(4) + use(5));
  renameSync(join(projects, "-x", "s.new"), join(projects, "-x", "s.jsonl"));
  const again = await details.of("s", first?.seq, first?.epoch);
  assert.notEqual(again?.epoch, first?.epoch, "though it is longer, it is another file");
  assert.deepEqual(again?.steps.map((step) => step.target), ["step 3", "step 4", "step 5"]);
});

test("work left in the background is settled by the harness's word that it ended, opened or listed", async () => {
  const projects = mkdtempSync(join(tmpdir(), "kyuren-projects-"));
  mkdirSync(join(projects, "-x"));
  const file = join(projects, "-x", "s.jsonl");
  writeFileSync(file, use(1, "Bash", { command: "cargo test", run_in_background: true }) + answer(1, { stdout: "", stderr: "", backgroundTaskId: "b1" }));
  const details = new SessionDetails(projects);
  assert.deepEqual((await details.of("s"))?.steps.map((step) => step.ok), [null]);
  const going = await details.step("s", "t1");
  assert.ok(going?.kind === "run");
  assert.deepEqual([going.ok, going.code, going.background], [null, null, true]);
  const notice = `<task-notification>\n<task-id>b1</task-id>\n<tool-use-id>t1</tool-use-id>\n<status>completed</status>\n</task-notification>`;
  appendFileSync(file, `${JSON.stringify({ type: "user", message: { role: "user", content: notice } })}\n`);
  assert.deepEqual((await details.of("s"))?.steps.map((step) => step.ok), [true]);
  const ended = await details.step("s", "t1");
  assert.deepEqual([ended?.ok], [true]);
});

const spoke = (text: string, extra: object = {}) =>
  `${JSON.stringify({ type: "assistant", cwd: "/x", ...extra, message: { content: [{ type: "text", text }] } })}\n`;

test("an opened session says what the agent said last, its own words and not a subagent's, and keeps up with it", async () => {
  const projects = mkdtempSync(join(tmpdir(), "kyuren-projects-"));
  mkdirSync(join(projects, "-x"));
  const file = join(projects, "-x", "s.jsonl");
  writeFileSync(file, spoke("Looking at the tests first.") + use(1) + answer(1, { stdout: "ok", stderr: "" }) + spoke("Which of the two should I keep?") + spoke("an aside", { isSidechain: true }));
  const details = new SessionDetails(projects);
  const first = await details.of("s");
  assert.equal(first?.said, "Which of the two should I keep?");
  appendFileSync(file, use(2));
  assert.equal((await details.of("s", first?.seq, first?.epoch))?.said, "Which of the two should I keep?", "a step after it is not a word");
  appendFileSync(file, spoke("Done: both kept."));
  assert.equal((await details.of("s", first?.seq, first?.epoch))?.said, "Done: both kept.");
});

test("a session that has said nothing yet says so", async () => {
  const projects = mkdtempSync(join(tmpdir(), "kyuren-projects-"));
  mkdirSync(join(projects, "-x"));
  writeFileSync(join(projects, "-x", "s.jsonl"), use(1));
  assert.equal((await new SessionDetails(projects).of("s"))?.said, null);
});
