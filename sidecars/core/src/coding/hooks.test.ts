import assert from "node:assert/strict";
import { mkdtempSync, statSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { HookListener } from "#coding/hooks.ts";
import type { Outbound } from "#protocol.ts";
import type { Transport } from "#transport.ts";

type Sent = Outbound & { event?: string; data?: { id?: string; decision?: string } };

function told(): { transport: Transport; sent: Sent[] } {
  const sent: Sent[] = [];
  return { sent, transport: { send: (message) => sent.push(message as Sent), listen: () => {} } };
}

function socketPath(): string {
  return join(mkdtempSync(join(tmpdir(), "kyuren-hooks-")), "hooks", "kyuren.sock");
}

const PERMISSION = { harness: "claude", event: "PermissionRequest", parent: 1, wait: 50 };
const BASH = { session_id: "s1", cwd: "/Users/someone/Code/kyuren", tool_name: "Bash", tool_input: { command: "make" } };

/// The relay's side: one event, its length in its header, then whatever is said back until the
/// line closes. Waiting for an answer, it keeps its side open, as the relay does.
function relay(path: string, header: typeof PERMISSION, payload: object): { answer: Promise<string>; leave: () => void } {
  const socket = connect(path);
  const chunks: Buffer[] = [];
  socket.on("data", (chunk: Buffer) => chunks.push(chunk));
  const answer = new Promise<string>((resolve) => socket.on("close", () => resolve(Buffer.concat(chunks).toString("utf8"))));
  socket.on("error", () => {});
  const body = JSON.stringify(payload);
  const said = `${JSON.stringify({ ...header, size: Buffer.byteLength(body) })}\n${body}`;
  if (header.wait > 0) socket.write(said);
  else socket.end(said);
  return { answer, leave: () => socket.destroy() };
}

async function until(seen: () => boolean): Promise<void> {
  for (let tries = 0; tries < 200 && !seen(); tries += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(seen(), "waited too long");
}

test("a permission question is held until it is answered on the island, and the answer goes back", async () => {
  const { transport, sent } = told();
  const path = socketPath();
  const hooks = new HookListener(transport, path);
  await hooks.start();
  assert.ok(hooks.listening());
  assert.equal(statSync(path).mode & 0o777, 0o600, "only this user may hand it anything");
  assert.equal(statSync(dirname(path)).mode & 0o777, 0o700, "in a folder no one else can look into");

  const asked = relay(path, PERMISSION, BASH);
  await until(() => hooks.pending().length === 1);
  const [held] = hooks.pending();
  assert.equal(hooks.seen(held?.id ?? ""), true, "the island says it has it");
  assert.deepEqual(held?.kind === "permission" ? [held.verb, held.target, held.project] : [], ["run", "make", "kyuren"]);
  assert.ok(sent.some((one) => one.event === "coding.permission" && one.data?.id === held?.id));

  assert.equal(hooks.answer(held?.id ?? "", { decision: "allow" }), true);
  assert.deepEqual(JSON.parse(await asked.answer).hookSpecificOutput.decision, { behavior: "allow" });
  assert.equal(hooks.pending().length, 0);
  assert.ok(sent.some((one) => one.event === "coding.permission.done" && one.data?.decision === "allow"));
  assert.equal(hooks.answer(held?.id ?? "", { decision: "deny" }), false, "answered once");
  await hooks.stop();
});

test("unanswered in time it is handed back to Claude Code, and a relay that leaves takes it away", async () => {
  const { transport, sent } = told();
  const path = socketPath();
  const hooks = new HookListener(transport, path, { askFor: 100 });
  await hooks.start();

  assert.equal(await relay(path, PERMISSION, BASH).answer, "", "nothing said, so Claude Code asks itself");
  assert.ok(sent.some((one) => one.event === "coding.permission.done" && one.data?.decision === "ask"));

  const leaving = new HookListener(transport, socketPath());
  await leaving.start();
  const gone = relay(leaving.path, PERMISSION, BASH);
  await until(() => leaving.pending().length === 1);
  gone.leave();
  await until(() => leaving.pending().length === 0);
  assert.ok(sent.some((one) => one.event === "coding.permission.done" && one.data?.decision === "gone"));
  await hooks.stop();
  await leaving.stop();
});

test("what is not a question to hold is let go at once", async () => {
  const { transport, sent } = told();
  const path = socketPath();
  const hooks = new HookListener(transport, path);
  await hooks.start();
  assert.equal(await relay(path, { ...PERMISSION, wait: 0 }, BASH).answer, "", "nothing waits on it");
  assert.equal(await relay(path, PERMISSION, { ...BASH, tool_name: "ExitPlanMode" }).answer, "", "a plan is read in Claude Code");
  assert.equal(await relay(path, { ...PERMISSION, harness: "elsewhere" }, BASH).answer, "");
  assert.equal(sent.length, 0);
  await hooks.stop();
});

test("a second Kyuren does not take the line from the one already answering on it", async () => {
  const { transport } = told();
  const path = socketPath();
  const first = new HookListener(transport, path);
  await first.start();
  const second = new HookListener(transport, path);
  await second.start();
  relay(path, PERMISSION, BASH);
  await until(() => first.pending().length === 1);
  assert.equal(second.pending().length, 0);
  await second.stop();
  await first.stop();
});

test("a question the island does not say it has seen is handed back at once, not held for nothing", async () => {
  const { transport, sent } = told();
  const hooks = new HookListener(transport, socketPath(), { seenWithin: 50, askFor: 400 });
  await hooks.start();
  const started = Date.now();
  assert.equal(await relay(hooks.path, PERMISSION, BASH).answer, "");
  assert.ok(Date.now() - started < 300, "long before its full wait");
  assert.ok(sent.some((one) => one.event === "coding.permission.done" && one.data?.decision === "ask"));

  const seen = relay(hooks.path, PERMISSION, BASH);
  await until(() => hooks.pending().length === 1);
  hooks.seen(hooks.pending()[0]?.id ?? "");
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(hooks.pending().length, 1, "seen, it is held for its whole wait");
  assert.equal(await seen.answer, "");
  await hooks.stop();
});

test("only so many questions are held at once, and one too slow to say itself is let go", async () => {
  const { transport } = told();
  const hooks = new HookListener(transport, socketPath(), { mostHeld: 2, saying: 100 });
  await hooks.start();
  const first = relay(hooks.path, PERMISSION, BASH);
  const second = relay(hooks.path, PERMISSION, BASH);
  await until(() => hooks.pending().length === 2);
  assert.equal(await relay(hooks.path, PERMISSION, BASH).answer, "", "a third is handed straight back");
  assert.equal(hooks.pending().length, 2);

  const slow = connect(hooks.path);
  const closed = new Promise<void>((resolve) => slow.on("close", () => resolve()));
  slow.on("error", () => {});
  const drip = setInterval(() => slow.write("{"), 20);
  const started = Date.now();
  await closed;
  clearInterval(drip);
  assert.ok(Date.now() - started < 1_000, "a trickle does not keep it open");

  assert.equal(await relay(hooks.path, { ...PERMISSION, size: 2 } as typeof PERMISSION, BASH).answer, "", "a header that is not one");
  first.leave();
  second.leave();
  await hooks.stop();
});

const CHOOSING = { harness: "claude", event: "PreToolUse", parent: 1, wait: 50 };
const QUESTIONS = [
  { question: "Which framework?", header: "Framework", options: [{ label: "React", description: "Components" }, { label: "Vue", description: "Progressive" }], multiSelect: false },
];
const ASKING = { session_id: "s1", cwd: "/Users/someone/Code/kyuren", tool_name: "AskUserQuestion", tool_input: { questions: QUESTIONS } };

test("questions to choose among come by the hook before the tool, and what is picked goes back with them as asked", async () => {
  const { transport } = told();
  const path = socketPath();
  const hooks = new HookListener(transport, path);
  await hooks.start();
  const asked = relay(path, CHOOSING, ASKING);
  await until(() => hooks.pending().length === 1);
  const [held] = hooks.pending();
  assert.equal(held?.kind, "choice");
  assert.equal(hooks.answer(held?.id ?? "", { decision: "allow", picked: { "Which framework?": ["Vue"] } }), true);
  const said = JSON.parse(await asked.answer).hookSpecificOutput;
  assert.deepEqual([said.hookEventName, said.permissionDecision], ["PreToolUse", "allow"]);
  assert.deepEqual(said.updatedInput, { questions: QUESTIONS, answers: { "Which framework?": "Vue" } });
  await hooks.stop();
});

test("an answer that does not fit its question is not given, and Claude Code asks it itself at once", async () => {
  const { transport, sent } = told();
  const path = socketPath();
  const hooks = new HookListener(transport, path);
  await hooks.start();
  const asked = relay(path, CHOOSING, ASKING);
  await until(() => hooks.pending().length === 1);
  const [held] = hooks.pending();
  assert.equal(hooks.seen(held?.id ?? ""), true, "the island says it has it");
  assert.equal(hooks.answer(held?.id ?? "", { decision: "allow", picked: { "Which framework?": ["Angular"] } }), false, "not one of its options");
  assert.equal(hooks.pending().length, 0, "let go at once, not left held where the island no longer shows it");
  assert.equal(await asked.answer, "", "nothing said, so Claude Code shows its own dialog");
  assert.ok(sent.some((one) => one.event === "coding.permission.done" && one.data?.id === held?.id && one.data?.decision === "ask"));
  await hooks.stop();
});

test("the hook before any other tool is let go at once, holding nothing", async () => {
  const { transport } = told();
  const path = socketPath();
  const hooks = new HookListener(transport, path);
  await hooks.start();
  assert.equal(await relay(path, CHOOSING, BASH).answer, "");
  assert.equal(hooks.pending().length, 0);
  await hooks.stop();
});

test("a plan is held longer than a permission, since it is to be read first", async () => {
  const { transport } = told();
  const path = socketPath();
  const hooks = new HookListener(transport, path, { askFor: 1_000, readFor: 5_000 });
  await hooks.start();
  const plan = { ...BASH, tool_name: "ExitPlanMode", tool_input: { plan: "## Refactor\n1. Extract the parser." } };
  const asked = [relay(path, PERMISSION, BASH), relay(path, PERMISSION, plan)];
  await until(() => hooks.pending().length === 2);
  const held = Object.fromEntries(hooks.pending().map((one) => [one.kind, one.until - one.at]));
  assert.deepEqual(held, { permission: 1_000, plan: 5_000 });
  await hooks.stop();
  for (const one of asked) assert.equal(await one.answer, "", "handed back when Kyuren stops");
});

test("a form from a server is answered with its values, or declined", async () => {
  const { transport } = told();
  const path = socketPath();
  const hooks = new HookListener(transport, path);
  await hooks.start();
  const event = { harness: "claude", event: "Elicitation", parent: 1, wait: 50 };
  const form = {
    session_id: "s1",
    cwd: "/Users/someone/Code/kyuren",
    hook_event_name: "Elicitation",
    mcp_server_name: "tickets",
    message: "Which board should the ticket go on?",
    mode: "form",
    requested_schema: { type: "object", properties: { board: { type: "string", enum: ["Inbox", "Sprint"] } }, required: ["board"] },
  };
  const first = relay(path, event, form);
  await until(() => hooks.pending().length === 1);
  assert.equal(hooks.answer(hooks.pending()[0]?.id ?? "", { decision: "allow", content: { board: "Sprint" } }), true);
  assert.deepEqual(JSON.parse(await first.answer).hookSpecificOutput, { hookEventName: "Elicitation", action: "accept", content: { board: "Sprint" } });
  const second = relay(path, event, form);
  await until(() => hooks.pending().length === 1);
  assert.equal(hooks.answer(hooks.pending()[0]?.id ?? "", { decision: "deny" }), true);
  assert.deepEqual(JSON.parse(await second.answer).hookSpecificOutput, { hookEventName: "Elicitation", action: "decline" });
  await hooks.stop();
});
