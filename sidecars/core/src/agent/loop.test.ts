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

function sayingThenCalling(text: string, name: string, args: object): Reply {
  return (response) =>
    streamed(response, { role: "assistant", content: text, tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name, arguments: JSON.stringify(args) } }] }, "tool_calls");
}

/// Takes the request and says nothing, as a model that has stalled before its first word.
const silent: Reply = () => undefined;

/// Begins an answer, as a provider does at once, and then says nothing more.
const begun: Reply = (response) => {
  response.writeHead(200, { "content-type": "text/event-stream" });
  response.write(sent({ choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] }));
};

/// Says a word or two of an answer and then nothing more.
const trailing: Reply = (response) => {
  response.writeHead(200, { "content-type": "text/event-stream" });
  response.write(sent({ choices: [{ index: 0, delta: { role: "assistant", content: "Let me" }, finish_reason: null }] }));
};

const failing: Reply = (response) => {
  response.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: "the scripted model gives up here" } }));
};

/// What each request to the model asked for, in order.
const bodies: string[] = [];

/// Answers a request that does not stream, as the difficulty judge's does.
function judged(word: string): Reply {
  return (response) => {
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
      id: "scripted", object: "chat.completion", created: 0, model: "scripted",
      choices: [{ index: 0, message: { role: "assistant", content: word }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
    }));
  };
}

const server = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => (body += chunk));
  request.on("end", () => {
    if (request.url !== "/v1/chat/completions") {
      response.writeHead(200, { "content-type": "application/json" }).end("{}");
      return;
    }
    bodies.push(body);
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

test("a model that says nothing within its limit fails the turn, and says so", async () => {
  replies.push(silent);
  const began = Date.now();
  const failure = await run({ prompt: "anything", vault, sensitive: true, difficulty: "hard", gate: gate(), ask: async () => "deny", silence: 300 })
    .then(() => undefined, (cause: unknown) => cause);
  assert.ok(failure instanceof TurnFailed, String(failure));
  assert.match(failure.message, /the model said nothing for 300 ms/);
  assert.ok(Date.now() - began < 5_000, "failed at the limit, not left waiting");
});

test("a question answered after the limit does not cut the turn off", async () => {
  const written = join(here, "slow-answer.md");
  replies.push(calling("write_file", { path: written, text: "kept" }), saying("Written."));
  const done = await run({
    prompt: "write it", vault, sensitive: true, difficulty: "hard", gate: gate(), silence: 300,
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

test("a model that only begins an answer, or stops part way through one, fails the turn as silent", async () => {
  for (const reply of [begun, trailing]) {
    replies.length = 0;
    replies.push(reply);
    const failure = await run({ prompt: "anything", vault, sensitive: true, difficulty: "hard", gate: gate(), ask: async () => "deny", silence: 300 })
      .then(() => undefined, (cause: unknown) => cause);
    assert.ok(failure instanceof TurnFailed, String(failure));
    assert.match(failure.message, /the model said nothing for 300 ms/);
  }
});

test("a model gone silent after a step that called a tool fails the turn, rather than ending it as answered", async () => {
  replies.push(calling("list_directory", { path: vault }), silent);
  const failure = await run({ prompt: "look", vault, sensitive: true, difficulty: "hard", gate: gate(), ask: async () => "deny", silence: 300 })
    .then(() => undefined, (cause: unknown) => cause);
  assert.ok(failure instanceof TurnFailed, String(failure));
  assert.match(failure.message, /the model said nothing/);
  assert.equal(failure.called[0]?.tool, "list_directory");
});

test("a turn stopped after a step that called a tool fails as stopped, rather than ending as answered", async () => {
  replies.push(calling("list_directory", { path: vault }), silent);
  const stopping = new AbortController();
  const failure = await run({
    prompt: "look", vault, sensitive: true, difficulty: "hard", gate: gate(), ask: async () => "deny", signal: stopping.signal,
    watching: {
      began: (tool) => tool,
      ended: () => void setTimeout(() => stopping.abort(), 100),
    },
  }).then(() => undefined, (cause: unknown) => cause);
  assert.ok(failure instanceof TurnFailed, String(failure));
  assert.equal(failure.message, "stopped before it finished");
});

test("a turn stopped while a question is open ends at once, and the question is withdrawn", async () => {
  const { createAsker } = await import("#agent/asker.ts");
  const told: Array<{ event: string; data: { id: string } }> = [];
  const stopping = new AbortController();
  const asker = createAsker({
    send: (message) => {
      told.push(message as { event: string; data: { id: string } });
      if ((message as { event?: string }).event === "permission.request") stopping.abort();
    },
    listen: () => undefined,
  });
  const written = join(here, "asked-then-stopped.md");
  replies.push(calling("write_file", { path: written, text: "no" }), saying("Written."));
  const began = Date.now();
  const failure = await run({ prompt: "write it", vault, sensitive: true, difficulty: "hard", gate: gate(), ask: asker.ask, signal: stopping.signal })
    .then(() => undefined, (cause: unknown) => cause);
  assert.ok(failure instanceof TurnFailed, String(failure));
  assert.equal(failure.message, "stopped before it finished");
  assert.ok(Date.now() - began < 5_000, "not left waiting on the answer");
  const asked = told.find((one) => one.event === "permission.request");
  assert.ok(told.some((one) => one.event === "permission.withdrawn" && one.data.id === asked?.data.id), "the windows are told it is gone");
  assert.equal(asker.pending(), 0);
  assert.equal(existsSync(written), false);
});

type Told = { event: string; data: Record<string, unknown> };

async function speakingHandlers(told: Told[]) {
  const { agentHandlers } = await import("#methods/agent.ts");
  return agentHandlers({ send: (message) => void told.push(message as Told), listen: () => undefined });
}

const aloud = (told: Told[]) => told.filter((one) => one.event.startsWith("agent.say"));

test("a spoken turn says its reply a sentence at a time as it arrives, and says when it is over", async () => {
  const told: Told[] = [];
  const handlers = await speakingHandlers(told);
  replies.push(saying("Your first meeting is at nine with the design team. The afternoon is completely free."));
  await handlers["agent.run"]({ prompt: "what is on", speak: true, id: "voice:1", sensitive: true, difficulty: "moderate" });
  assert.deepEqual(aloud(told), [
    { event: "agent.say", data: { id: "voice:1", text: "Your first meeting is at nine with the design team." } },
    { event: "agent.say", data: { id: "voice:1", text: "The afternoon is completely free." } },
    { event: "agent.say.end", data: { id: "voice:1" } },
  ]);
});

test("a turn not asked to be spoken says nothing aloud", async () => {
  const told: Told[] = [];
  const handlers = await speakingHandlers(told);
  replies.push(saying("Your first meeting is at nine with the design team."));
  await handlers["agent.run"]({ prompt: "what is on", id: "chat:1", sensitive: true, difficulty: "moderate" });
  assert.deepEqual(aloud(told), []);
});

test("a spoken turn stopped part way says nothing more, and still says it is over", async () => {
  const told: Told[] = [];
  const handlers = await speakingHandlers(told);
  replies.push(silent);
  const running = handlers["agent.run"]({ prompt: "what is on", speak: true, id: "voice:2", sensitive: true, difficulty: "moderate" })
    .then(() => undefined, (cause: unknown) => cause);
  await new Promise((later) => setTimeout(later, 200));
  await handlers["agent.stop"]({ id: "voice:2" });
  assert.ok(await running instanceof Error);
  assert.deepEqual(aloud(told), [{ event: "agent.say.end", data: { id: "voice:2" } }]);
});

test("a question judged known is put to the model without reasoning, spoken or typed", async () => {
  const handlers = await speakingHandlers([]);
  const answer = "Photosynthesis is how plants turn light into sugar.";

  bodies.length = 0;
  replies.push(judged("known"), judged("yes"), saying(answer));
  await handlers["agent.run"]({ prompt: "what is photosynthesis", speak: true, id: "voice:known", sensitive: true });
  assert.match(bodies[2] ?? "", /"reasoning_effort":"none"/);

  bodies.length = 0;
  replies.push(judged("known"), judged("no"), saying(answer));
  await handlers["agent.run"]({ prompt: "what is photosynthesis", speak: true, id: "voice:doubted", sensitive: true });
  assert.doesNotMatch(bodies[2] ?? "", /reasoning_effort/, "known only once no encyclopedia would fall short");

  bodies.length = 0;
  replies.push(judged("moderate"), judged("known"), judged("yes"), saying(answer));
  await handlers["agent.run"]({ prompt: "What is photosynthesis?", id: "chat:known", sensitive: true });
  assert.match(bodies[3] ?? "", /"reasoning_effort":"none"/, "typed, judged hard or not by the typed judge first");

  bodies.length = 0;
  replies.push(judged("hard"), saying(answer));
  await handlers["agent.run"]({ prompt: "Plan my week around these deadlines.", id: "chat:hard", sensitive: true });
  assert.equal(bodies.length, 2, "hard to the typed judge, nothing more is asked of the judges");
});

/// Drafting a skill speaks for itself. Each test drafts its own, since a name once drafted is taken.
const forging = (name: string) => calling("forge", {
  name,
  about: "Tide times for a harbour, by name.",
  url: "https://example.com/tides/{harbour}",
  parameters: [{ name: "harbour", in: "path" }],
});
const forged = (name: string) => `${name} is drafted and waiting to be approved. It is not callable yet.`;

test("a tool's words to be spoken are told the moment the tool gives them, before the model's next step", async () => {
  const order: string[] = [];
  replies.push(forging("tides"), saying("The tides skill is drafted."));
  await run({
    prompt: "keep the tides endpoint", vault, sensitive: true, difficulty: "moderate", gate: gate(), ask: async () => "allow",
    onSpoken: (said) => order.push(said),
    onStep: () => order.push("step"),
    onTool: () => order.push("tool"),
  });
  assert.deepEqual(order, ["step", "tool", forged("tides"), "step"]);
});

test("a spoken turn whose tool has spoken is over once the model moves on, and its retelling is not said", async () => {
  const told: Told[] = [];
  const { agentHandlers } = await import("#methods/agent.ts");
  const handlers = agentHandlers({
    send: (message) => {
      const one = message as Told;
      told.push(one);
      if (one.event === "permission.request") void handlers["permission.answer"]?.({ id: one.data.id, verdict: "allow" });
    },
    listen: () => undefined,
  });
  replies.push(forging("harbour_tides"), saying("The tides skill is drafted and waits for you to approve it."));
  await handlers["agent.run"]?.({ prompt: "keep the tides endpoint", speak: true, id: "voice:forge", sensitive: true, difficulty: "moderate" });
  assert.deepEqual(aloud(told), [
    { event: "agent.say", data: { id: "voice:forge", text: forged("harbour_tides") } },
    { event: "agent.say.end", data: { id: "voice:forge" } },
    { event: "agent.say.end", data: { id: "voice:forge" } },
  ]);
});

test("a spoken turn's words before a tool are over once the tool begins, so nothing is held open through it", async () => {
  const told: Told[] = [];
  const { agentHandlers } = await import("#methods/agent.ts");
  const handlers = agentHandlers({
    send: (message) => {
      const one = message as Told;
      told.push(one);
      if (one.event === "permission.request") void handlers["permission.answer"]?.({ id: one.data.id, verdict: "allow" });
    },
    listen: () => undefined,
  });
  replies.push(
    sayingThenCalling("Let me draft that for you", "forge", { name: "ferry_times", about: "Ferry times for a harbour, by name.", url: "https://example.com/ferries/{harbour}", parameters: [{ name: "harbour", in: "path" }] }),
    saying("It is drafted."),
  );
  await handlers["agent.run"]?.({ prompt: "keep the ferry endpoint", speak: true, id: "voice:before", sensitive: true, difficulty: "moderate" });
  assert.deepEqual(aloud(told), [
    { event: "agent.say", data: { id: "voice:before", text: "Let me draft that for you" } },
    { event: "agent.say.end", data: { id: "voice:before" } },
    { event: "agent.say", data: { id: "voice:before", text: forged("ferry_times") } },
    { event: "agent.say.end", data: { id: "voice:before" } },
    { event: "agent.say.end", data: { id: "voice:before" } },
  ]);
});
