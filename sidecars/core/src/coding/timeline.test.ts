import assert from "node:assert/strict";
import { test } from "node:test";
import { timelineOf } from "#coding/timeline.ts";

const CWD = "/Users/someone/Code/kyuren";
let n = 0;
function use(name: string, input: object, at = "2026-10-02T10:00:00Z") {
  n += 1;
  return { id: `t${n}`, line: JSON.stringify({ type: "assistant", cwd: CWD, gitBranch: "main", timestamp: at, message: { content: [{ type: "tool_use", id: `t${n}`, name, input }] } }) };
}
function result(id: string, toolUseResult: object | string, isError = false) {
  return JSON.stringify({ type: "user", cwd: CWD, message: { content: [{ type: "tool_result", tool_use_id: id, content: "", is_error: isError }] }, toolUseResult });
}

test("a session is read as its task, what it changed, its tests and every step", () => {
  const edit = use("Edit", { file_path: `${CWD}/src/a.ts`, old_string: "x", new_string: "y" });
  const write = use("Write", { file_path: `${CWD}/src/b.ts`, content: "a\nb" });
  const tests = use("Bash", { command: "cargo test 2>&1 | tail -3" });
  const running = use("Bash", { command: "pnpm build" });
  const lines = [
    JSON.stringify({ type: "last-prompt", lastPrompt: "make the volume thinner\nplease", sessionId: "s" }),
    edit.line,
    result(edit.id, { filePath: `${CWD}/src/a.ts`, structuredPatch: [{ oldStart: 3, oldLines: 2, newStart: 3, newLines: 3, lines: [" keep", "-old", "+new", "+more"] }] }),
    write.line,
    result(write.id, { type: "create", filePath: `${CWD}/src/b.ts`, content: "a\nb\n", structuredPatch: [], originalFile: null }),
    tests.line,
    result(tests.id, { stdout: "test result: ok. 30 passed; 0 failed\ntest result: ok. 9 passed; 0 failed", stderr: "" }),
    running.line,
  ];
  const detail = timelineOf(lines).detail(0);
  assert.equal(detail.task, "make the volume thinner please");
  assert.equal(detail.branch, "main");
  assert.deepEqual(
    detail.files.map((one) => [one.path, one.added, one.removed, one.steps]),
    [["src/b.ts", 2, 0, [write.id]], ["src/a.ts", 2, 1, [edit.id]]],
    "newest first, by place in the project, a file written new all put in",
  );
  assert.deepEqual(detail.tests && [detail.tests.passed, detail.tests.failed, detail.tests.ok, detail.tests.step], [39, 0, true, tests.id], "and the run that said so");
  assert.deepEqual(detail.steps.map((one) => one.id), [edit.id, write.id, tests.id, running.id]);
  assert.deepEqual(detail.steps.map((one) => [one.verb, one.target, one.ok]), [
    ["edit", "src/a.ts", true],
    ["write", "src/b.ts", true],
    ["run", "cargo test 2>&1 | tail -3", true],
    ["run", "pnpm build", null],
  ], "the last one still running");
});

test("what a subagent did is passed over in its parent's transcript and read in its own, and lines that do not read are passed over", () => {
  const side = use("Bash", { command: "ls" });
  const aside = JSON.stringify({ type: "assistant", isSidechain: true, message: { content: [{ type: "tool_use", id: side.id, name: "Bash", input: { command: "ls" } }] } });
  assert.deepEqual(timelineOf(["not json", aside]).detail(0).steps, []);
  assert.deepEqual(timelineOf(["not json", aside], null, true).detail(0).steps.map((one) => one.target), ["ls"]);
});

test("every step is kept, however long the session", () => {
  const lines = Array.from({ length: 40 }, (_, k) => use("Read", { file_path: `${CWD}/f${k}.ts` }).line);
  assert.equal(timelineOf(lines).detail(0).steps.length, 40);
});

test("asked again, only the steps added or finished since are given", () => {
  const first = use("Bash", { command: "cargo build" });
  const second = use("Read", { file_path: `${CWD}/a.ts` });
  const timeline = timelineOf([first.line]);
  const before = timeline.detail(0);
  assert.deepEqual(before.steps.map((one) => [one.id, one.ok]), [[first.id, null]]);
  let at = 10_000;
  for (const line of [result(first.id, { stdout: "ok", stderr: "" }), second.line]) {
    timeline.feed(line, { at, length: Buffer.byteLength(line) });
    at += Buffer.byteLength(line) + 1;
  }
  const after = timeline.detail(before.seq);
  assert.deepEqual(after.steps.map((one) => [one.id, one.ok]), [[first.id, true], [second.id, null]], "the first finished, the second new");
  assert.deepEqual(timeline.detail(after.seq).steps, [], "nothing since");
  assert.equal(after.total, 2);
  assert.equal(after.epoch, before.epoch);
  assert.deepEqual(timeline.spans(first.id)?.result, { at: 10_000, length: Buffer.byteLength(result(first.id, { stdout: "ok", stderr: "" })) }, "where its outcome lies in the file");
});

test("files are named from the session's project folder, wherever the agent has since moved to", () => {
  const moved = (line: string) => line.replaceAll(`"cwd":"${CWD}"`, `"cwd":"${CWD}/apps/desktop"`);
  const read = use("Read", { file_path: `${CWD}/apps/desktop/src/c.ts` });
  const edit = use("Edit", { file_path: `${CWD}/apps/desktop/src/c.ts`, old_string: "x", new_string: "y" });
  const lines = [read.line, edit.line, result(edit.id, { filePath: `${CWD}/apps/desktop/src/c.ts`, structuredPatch: [] })].map(moved);
  const detail = timelineOf(lines, CWD).detail(0);
  assert.deepEqual(detail.files.map((one) => one.path), ["apps/desktop/src/c.ts"]);
  assert.equal(detail.steps[0]?.target, "apps/desktop/src/c.ts");
  assert.deepEqual(timelineOf(lines).detail(0).files.map((one) => one.path), ["src/c.ts"], "without it, from where the agent is");
});

test("a failed test run keeps its counts, though the harness keeps only what it printed", () => {
  const tests = use("Bash", { command: "cargo test" });
  const lines = [tests.line, result(tests.id, "Error: Exit code 101\ntest result: FAILED. 38 passed; 1 failed; 0 ignored", true)];
  const run = timelineOf(lines).detail(0).tests;
  assert.deepEqual(run && [run.passed, run.failed, run.ok], [38, 1, false]);
});

test("files a command changed are read from what the harness saw it change", () => {
  const sed = use("Bash", { command: "sed -i '' 's/a/b/' src/c.ts && touch src/d.ts" });
  const lines = [
    sed.line,
    result(sed.id, {
      stdout: "",
      stderr: "",
      bashEditDiff: {
        changedFiles: [`${CWD}/src/c.ts`, `${CWD}/src/d.ts`],
        files: [
          { filePath: `${CWD}/src/c.ts`, hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-a", "+b"] }] },
          { filePath: `${CWD}/src/d.ts`, created: true, hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 1, lines: ["+x"] }] },
        ],
        moreFiles: 0,
      },
    }),
  ];
  assert.deepEqual(timelineOf(lines).detail(0).files.map((one) => [one.path, one.added, one.removed]), [["src/d.ts", 1, 0], ["src/c.ts", 1, 1]]);
});

test("a long line is cut between characters, never inside one", () => {
  const long = use("Bash", { command: `echo ${"x".repeat(133)}${"\u{1F600}".repeat(10)}` });
  const target = timelineOf([long.line]).detail(0).steps[0]?.target ?? "";
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(target), "no half of a character is left");
  assert.ok(target.endsWith("…"));
});

const ended = (id: string, status: string) =>
  JSON.stringify({
    type: "user",
    message: { role: "user", content: `<task-notification>\n<task-id>b1</task-id>\n<tool-use-id>${id}</tool-use-id>\n<output-file>/tmp/b1.output</output-file>\n<status>${status}</status>\n<summary>done</summary>\n</task-notification>` },
  });

test("work left running in the background is still going until the harness says how it ended", () => {
  const agent = use("Agent", { description: "look around", prompt: "list the files", run_in_background: true });
  const tests = use("Bash", { command: "cargo test", run_in_background: true });
  const launched = [
    agent.line,
    result(agent.id, { agentId: "a1", status: "async_launched", isAsync: true, description: "look around", prompt: "list the files", outputFile: "/tmp/a1" }),
    tests.line,
    result(tests.id, { stdout: "", stderr: "", interrupted: false, backgroundTaskId: "b1" }),
  ];
  const timeline = timelineOf(launched);
  const before = timeline.detail(0);
  assert.deepEqual(before.steps.map((one) => one.ok), [null, null], "launched is not done");
  assert.equal(before.tests, null, "a test run in the background has not said how it went");

  let at = 100_000;
  for (const line of [ended(tests.id, "failed"), ended(agent.id, "completed"), ended("toolu_unknown", "completed")]) {
    timeline.feed(line, { at, length: Buffer.byteLength(line) });
    at += Buffer.byteLength(line) + 1;
  }
  const after = timeline.detail(before.seq);
  assert.deepEqual(after.steps.map((one) => [one.id, one.ok]), [[agent.id, true], [tests.id, false]]);
});

test("the word that background work ended is found however it was delivered, by whichever id it names", () => {
  const build = use("Bash", { command: "pnpm bundle", run_in_background: true });
  const watch = use("Bash", { command: "tail -f log", run_in_background: true });
  const agent = use("Agent", { description: "review", prompt: "look", run_in_background: true });
  const timeline = timelineOf([
    build.line,
    result(build.id, { stdout: "", stderr: "", backgroundTaskId: "bld1" }),
    watch.line,
    result(watch.id, { stdout: "", stderr: "", backgroundTaskId: "wch1" }),
    agent.line,
    result(agent.id, { agentId: "a9", status: "async_launched", isAsync: true }),
  ]);
  const before = timeline.detail(0);
  const queued = JSON.stringify({ type: "attachment", attachment: { type: "queued_command", prompt: "<task-notification>\n<task-id>bld1</task-id>\n<status>completed</status>\n<summary>Background command finished</summary>\n</task-notification>" } });
  const progress = JSON.stringify({ type: "queue-operation", operation: "enqueue", content: "<task-notification>\n<task-id>wch1</task-id>\n<summary>Monitor event</summary>\n<event>a line</event>\n</task-notification>" });
  const handBack = JSON.stringify({ type: "user", message: { role: "user", content: '<agent-message from="a9">\n[Subagent hand-back] The text below is the final report.\n</agent-message>' } });
  let at = 200_000;
  for (const line of [queued, progress, handBack]) {
    timeline.feed(line, { at, length: Buffer.byteLength(line) });
    at += Buffer.byteLength(line) + 1;
  }
  const after = timeline.detail(before.seq);
  assert.deepEqual(after.steps.map((one) => [one.id, one.ok]), [[build.id, true], [agent.id, true]], "a word of progress is not an end");
  assert.equal(timeline.okOf(watch.id), null);
});
