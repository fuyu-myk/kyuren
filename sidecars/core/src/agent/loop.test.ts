import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";

/// The local model, scripted: each request to it is answered by the next reply in line, the way the
/// local route is reached, so the turn under test is the real one from end to end.
type Reply = (response: ServerResponse) => void;
const replies: Reply[] = [];

function sent(body: object): string {
  return `data: ${JSON.stringify({ id: "scripted", object: "chat.completion.chunk", created: 0, model: "scripted", ...body })}\n\n`;
}

function streamed(response: ServerResponse, delta: object, finish: string): void {
  response.writeHead(200, { "content-type": "text/event-stream" });
  response.write(sent({ choices: [{ index: 0, delta, finish_reason: null }] }));
  response.write(sent({ choices: [{ index: 0, delta: {}, finish_reason: finish }] }));
  response.write(sent({ choices: [], usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 } }));
  response.end("data: [DONE]\n\n");
}

function calling(name: string, args: object): Reply {
  return (response) =>
    streamed(response, { role: "assistant", tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name, arguments: JSON.stringify(args) } }] }, "tool_calls");
}

function saying(text: string): Reply {
  return (response) => streamed(response, { role: "assistant", content: text }, "stop");
}

/// Takes the request and says nothing, as a model that has stalled before its first word.
const silent: Reply = () => undefined;

const failing: Reply = (response) => {
  response.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: "the scripted model gives up here" } }));
};

const server = createServer((request, response) => {
  request.resume();
  request.on("end", () => {
    if (request.url !== "/v1/chat/completions") {
      response.writeHead(200, { "content-type": "application/json" }).end("{}");
      return;
    }
    (replies.shift() ?? failing)(response);
  });
});
await new Promise<void>((ready) => server.listen(0, "127.0.0.1", () => ready()));

const here = mkdtempSync(join(tmpdir(), "kyuren-loop-"));
const vault = join(here, "home", "vault");
mkdirSync(vault, { recursive: true });
process.env.KYUREN_HOME = join(here, "home");
process.env.KYUREN_VAULT = vault;
process.env.KYUREN_OLLAMA_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;

// Whether the cloud can be reached is asked of the cloud itself; here it answers at once, and
// nothing else is sent there.
const reaching = globalThis.fetch;
globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) =>
  String(input instanceof Request ? input.url : input).startsWith("https://api.anthropic.com")
    ? Promise.resolve(new Response(null, { status: 401 }))
    : reaching(input, init)) as typeof fetch;

const { run } = await import("#agent/loop.ts");
const { TurnFailed } = await import("#agent/failed.ts");
const { Gate } = await import("#permission/gate.ts");

after(() => {
  server.closeAllConnections();
  server.close();
  rmSync(here, { recursive: true, force: true });
});

const gate = () => new Gate(() => [{ path: vault, mode: "write" }], () => {});

// A reply one test left unused would answer the next test's turn.
beforeEach(() => {
  replies.length = 0;
});

test("a turn that fails part way hands back the calls it made, which were asked about, and what its steps cost", async () => {
  const written = join(here, "outside.md");
  replies.push(calling("write_file", { path: written, text: "half" }), failing);
  const asked: string[] = [];
  const failure = await run({
    prompt: "write it", vault, sensitive: true, difficulty: "hard", gate: gate(),
    ask: async (action) => {
      asked.push(action.target);
      return "allow";
    },
  }).then(() => undefined, (cause: unknown) => cause);

  assert.ok(failure instanceof TurnFailed, String(failure));
  assert.match(failure.message, /the model stopped answering/);
  assert.deepEqual(failure.called.map(({ tool, ok, asked: was }) => ({ tool, ok, asked: was })), [{ tool: "write_file", ok: true, asked: true }]);
  assert.deepEqual(asked, [written]);
  assert.ok(existsSync(written), "the call it made was made");
  assert.equal(failure.spent?.input, 120, "the step it finished is counted");
});

test("a call the gate allows without a question is not taken for one that was asked about", async () => {
  replies.push(calling("list_directory", { path: vault }), saying("Nothing is there."));
  const done = await run({ prompt: "look", vault, sensitive: true, difficulty: "hard", gate: gate(), ask: async () => "deny" });
  assert.equal(done.text, "Nothing is there.");
  assert.equal(done.called[0]?.tool, "list_directory");
  assert.equal(done.called[0]?.ok, true);
  assert.notEqual(done.called[0]?.asked, true);
});

test("a model that says nothing within its first-word limit fails the turn, and says so", async () => {
  replies.push(silent);
  const began = Date.now();
  const failure = await run({ prompt: "anything", vault, sensitive: true, difficulty: "hard", gate: gate(), ask: async () => "deny", firstWord: 300 })
    .then(() => undefined, (cause: unknown) => cause);
  assert.ok(failure instanceof TurnFailed, String(failure));
  assert.match(failure.message, /did not begin to answer/);
  assert.ok(Date.now() - began < 5_000, "failed at the limit, not left waiting");
});

test("a question answered after the first-word limit does not cut the turn off", async () => {
  const written = join(here, "slow-answer.md");
  replies.push(calling("write_file", { path: written, text: "kept" }), saying("Written."));
  const done = await run({
    prompt: "write it", vault, sensitive: true, difficulty: "hard", gate: gate(), firstWord: 300,
    ask: async () => {
      await new Promise((later) => setTimeout(later, 900));
      return "allow";
    },
  });
  assert.equal(done.text, "Written.");
  assert.ok(existsSync(written));
});

test("a turn its caller stops says it was stopped, and what it was about to do is not done", async () => {
  const written = join(here, "never.md");
  replies.push(calling("write_file", { path: written, text: "no" }), saying("Written."));
  const stopping = new AbortController();
  const failure = await run({
    prompt: "write it", vault, sensitive: true, difficulty: "hard", gate: gate(), signal: stopping.signal,
    ask: async () => {
      stopping.abort();
      return "allow";
    },
  }).then(() => undefined, (cause: unknown) => cause);
  assert.ok(failure instanceof TurnFailed, String(failure));
  assert.equal(failure.message, "stopped before it finished");
  assert.equal(existsSync(written), false);
});

test("a playbook run the window started can be stopped by the name it gave it, even while the model is silent", async () => {
  const { agentHandlers } = await import("#methods/agent.ts");
  const { sharedPlaybooks } = await import("#playbook/shared.ts");
  const books = sharedPlaybooks();
  books.propose(`---
name: stalls
when: a test of stopping a run
inputs:
  - topic: what it is about
skills: [write_file]
version: 1
author: claude-opus-5-5 on 2026-10-03
---

## Steps

1. Write a line about {{topic}} to ~/stalls.md.

## Proof

1. file exists: ~/stalls.md
`);
  books.approve("stalls", "test");
  const handlers = agentHandlers({ send: () => undefined, listen: () => undefined });
  replies.push(silent);
  const running = handlers["playbook.invoke"]({ name: "stalls", text: "anything", pane: "chat", id: "chat:stalls" })
    .then(() => undefined, (cause: unknown) => cause);
  await new Promise((later) => setTimeout(later, 300));
  assert.deepEqual(await handlers["agent.stop"]({ id: "chat:stalls" }), { stopped: true });
  const failure = await running;
  assert.ok(failure instanceof Error, String(failure));
  assert.equal(failure.message, "stopped before it finished");
});
