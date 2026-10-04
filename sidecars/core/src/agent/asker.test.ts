import assert from "node:assert/strict";
import { test } from "node:test";
import { createAsker } from "#agent/asker.ts";

test("a question says what would go with it and why it is asked, as well as where", async () => {
  const sent: unknown[] = [];
  const asker = createAsker({ send: (message) => void sent.push(message), listen: () => undefined });
  const answer = asker.ask({ tool: "web_search", effect: "outbound", target: "https://engine.example", carrying: "the note" }, "this conversation has read your notes");
  const question = (sent[0] as { data: Record<string, unknown> }).data;
  assert.equal(question.target, "https://engine.example");
  assert.equal(question.carrying, "the note");
  assert.equal(question.why, "this conversation has read your notes");
  asker.answer(question.id as string, "deny");
  assert.equal(await answer, "deny");
});

test("a question still open when what asked it is stopped is withdrawn, and answering it after does nothing", async () => {
  const sent: Array<{ event: string; data: Record<string, unknown> }> = [];
  const asker = createAsker({ send: (message) => void sent.push(message as { event: string; data: Record<string, unknown> }), listen: () => undefined });
  const stopping = new AbortController();
  const answer = asker.ask({ tool: "write_file", effect: "write", target: "/tmp/x.md" }, undefined, stopping.signal);
  const id = sent[0]?.data.id;
  stopping.abort();
  assert.equal(await answer, "deny");
  assert.deepEqual(sent[1], { event: "permission.withdrawn", data: { id } });
  assert.equal(asker.pending(), 0);
  assert.equal(asker.answer(id as string, "allow"), false);
});

test("nothing is asked for what was stopped before the question was put", async () => {
  const sent: unknown[] = [];
  const asker = createAsker({ send: (message) => void sent.push(message), listen: () => undefined });
  const stopped = new AbortController();
  stopped.abort();
  assert.equal(await asker.ask({ tool: "write_file", effect: "write", target: "/tmp/x.md" }, undefined, stopped.signal), "deny");
  assert.deepEqual(sent, []);
});
