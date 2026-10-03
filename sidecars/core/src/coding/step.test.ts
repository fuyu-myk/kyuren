import assert from "node:assert/strict";
import { test } from "node:test";
import { stepDetail } from "#coding/step.ts";

const CWD = "/x/kyuren";
const used = (id: string, name: string, input: object) => JSON.stringify({ type: "assistant", cwd: CWD, message: { content: [{ type: "tool_use", id, name, input }] } });
const answered = (id: string, toolUseResult: unknown, content: unknown = "", isError = false) =>
  JSON.stringify({ type: "user", cwd: CWD, message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] }, toolUseResult });

test("a command shows what it ran, the end of what it printed, how it ended and what it changed", () => {
  const output = Array.from({ length: 250 }, (_, k) => `line ${k + 1}`).join("\n");
  const edited = { files: [{ filePath: `${CWD}/a.ts`, hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-a", "+b"] }] }] };
  const run = stepDetail("r1", used("r1", "Bash", { command: "cargo test", description: "Run the tests" }), answered("r1", { stdout: output, stderr: "", bashEditDiff: edited }), CWD);
  assert.ok(run?.kind === "run");
  assert.deepEqual([run.command, run.about, run.code, run.ok], ["cargo test", "Run the tests", 0, true]);
  assert.deepEqual([run.output.length, run.earlier, run.output.at(-1)], [200, 50, "line 250"], "the end, where a run says how it went");
  assert.deepEqual(run.changes.map((one) => [one.path, one.added, one.removed]), [["a.ts", 1, 1]]);

  const failed = stepDetail("r2", used("r2", "Bash", { command: "false" }), answered("r2", "Error: Exit code 1\nnope", "Exit code 1\nnope", true), CWD);
  assert.ok(failed?.kind === "run");
  assert.deepEqual([failed.code, failed.ok, failed.output], [1, false, ["Error: Exit code 1", "nope"]]);

  const going = stepDetail("r3", used("r3", "Bash", { command: "sleep 9" }), undefined, CWD);
  assert.ok(going?.kind === "run");
  assert.deepEqual([going.ok, going.code, going.output], [null, null, []]);
});

test("a command is shown whole however long, and what it printed whole when asked for", () => {
  const command = Array.from({ length: 300 }, (_, k) => `echo ${"x".repeat(500)} ${k}`).join("\n");
  const output = Array.from({ length: 250 }, (_, k) => `${"y".repeat(450)} ${k}`).join("\n");
  const lines = [used("r4", "Bash", { command }), answered("r4", { stdout: output, stderr: "" })] as const;
  const shown = stepDetail("r4", ...lines, CWD);
  assert.ok(shown?.kind === "run");
  assert.equal(shown.command, command, "every line of it, each whole");
  assert.deepEqual([shown.output.length, shown.earlier], [200, 50], "at first, the end of what it printed");
  const whole = stepDetail("r4", ...lines, CWD, true);
  assert.ok(whole?.kind === "run");
  assert.deepEqual([whole.output.length, whole.earlier], [250, 0]);
  assert.equal(whole.output.join("\n"), output, "all of it, as it printed it");
});

test("an edit shows its change, and one that failed says why", () => {
  const patch = [{ oldStart: 2, oldLines: 1, newStart: 2, newLines: 1, lines: ["-x", "+y"] }];
  const edit = stepDetail("e1", used("e1", "Edit", { file_path: `${CWD}/b.ts` }), answered("e1", { filePath: `${CWD}/b.ts`, structuredPatch: patch }), CWD);
  assert.ok(edit?.kind === "edit");
  assert.deepEqual(edit.changes[0]?.diff, [{ kind: "@", text: "@@ -2,1 +2,1 @@" }, { kind: "-", text: "x" }, { kind: "+", text: "y" }]);
  assert.deepEqual(edit.output, [], "a change that went in needs no words");

  const missed = stepDetail("e2", used("e2", "Edit", { file_path: `${CWD}/b.ts` }), answered("e2", "Error: String to replace not found", "", true), CWD);
  assert.ok(missed?.kind === "edit");
  assert.deepEqual([missed.changes, missed.output], [[], ["Error: String to replace not found"]]);
});

test("a read shows which lines it read and what they said, and of a picture only that it was one", () => {
  const file = { filePath: `${CWD}/c.ts`, content: "one\ntwo", numLines: 2, startLine: 5, totalLines: 40 };
  const read = stepDetail("d1", used("d1", "Read", { file_path: `${CWD}/c.ts` }), answered("d1", { type: "text", file }), CWD);
  assert.ok(read?.kind === "read");
  assert.deepEqual([read.path, read.from, read.lines, read.of, read.content, read.image], ["c.ts", 5, 2, 40, ["one", "two"], false]);

  const picture = stepDetail("d2", used("d2", "Read", { file_path: `${CWD}/p.png` }), answered("d2", { type: "image", file: { base64: "AAAA", type: "image/png" } }), CWD);
  assert.ok(picture?.kind === "read");
  assert.deepEqual([picture.image, picture.content], [true, []]);
});

test("a step handed to an agent shows what it was asked and which agent took it", () => {
  const input = { description: "Review the diff", prompt: "Look at the changes" };
  const agent = stepDetail("a1", used("a1", "Agent", input), answered("a1", { agentId: "abc123", status: "completed" }, [{ type: "text", text: "All good." }]), CWD);
  assert.ok(agent?.kind === "agent");
  assert.deepEqual([agent.about, agent.prompt, agent.agent, agent.output, agent.steps], ["Review the diff", "Look at the changes", "abc123", ["All good."], []]);
});

test("anything else shows what it was given and what came back, and a plan its items", () => {
  const fetched = stepDetail("w1", used("w1", "WebFetch", { url: "https://example.com", prompt: "summarise" }), answered("w1", { url: "https://example.com", code: 200, result: "A page." }, "A page."), CWD);
  assert.ok(fetched?.kind === "other");
  assert.deepEqual([fetched.fields, fetched.output], [[["url", "https://example.com"], ["prompt", "summarise"]], ["A page."]]);

  const todos = [{ content: "write the test", status: "completed" }, { content: "make it pass", status: "in_progress" }, { content: "commit", status: "pending" }];
  const plan = stepDetail("p1", used("p1", "TodoWrite", { todos }), answered("p1", { oldTodos: [], newTodos: todos }), CWD);
  assert.ok(plan?.kind === "other");
  assert.deepEqual(plan.output, ["done: write the test", "doing: make it pass", "to do: commit"]);

  assert.equal(stepDetail("w2", used("w1", "WebFetch", {}), undefined, CWD), null, "a step is found by its own id");
});
