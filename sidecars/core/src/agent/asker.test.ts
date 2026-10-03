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
