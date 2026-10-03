import assert from "node:assert/strict";
import { test } from "node:test";
import { messagesFor, moment } from "#agent/moment.ts";

const at = new Date(Date.UTC(2026, 9, 2, 21, 5));

test("the model is told the date, the time and the time zone", () => {
  assert.equal(moment(at, "America/Los_Angeles"), "It is Friday 2 October 2026, 2:05 pm, in the America/Los_Angeles time zone.");
  assert.equal(moment(at, "Asia/Singapore"), "It is Saturday 3 October 2026, 5:05 am, in the Asia/Singapore time zone.");
});

test("only the turn's own message carries the moment, so what came before stays the same and cached", () => {
  const history = [
    { role: "user" as const, text: "what's for tomorrow" },
    { role: "assistant" as const, text: "Nothing is on." },
  ];
  const messages = messagesFor(history, "and on Monday?", at, "America/Los_Angeles");
  assert.deepEqual(messages.slice(0, 2), [
    { role: "user", content: "what's for tomorrow" },
    { role: "assistant", content: "Nothing is on." },
  ]);
  assert.equal(messages[2]?.role, "user");
  assert.match(String(messages[2]?.content), /^It is Friday 2 October 2026, 2:05 pm, in the America\/Los_Angeles time zone\.\n\nand on Monday\?$/);
});
