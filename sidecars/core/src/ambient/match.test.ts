import assert from "node:assert/strict";
import { test } from "node:test";
import { matching } from "#ambient/match.ts";
import type { Rule } from "#ambient/rules.ts";
import type { Item } from "#connect/source.ts";

const now = new Date("2026-09-17T10:00:00Z");

function item(kind: Item["kind"], title: string, at: string, more: Partial<Item> = {}): Item {
  return { source: "test", kind, collection: "c", title, at, timed: true, done: false, ...more };
}

const never = () => false;

test("an event about to start fires, once, with how soon", () => {
  const rule: Rule = { id: "soon", when: "event", within: 10, voice: false };
  const soon = item("event", "Design review", "2026-09-17T10:07:00Z");
  const fired = matching([rule], [soon], now, undefined, never);
  assert.equal(fired.length, 1);
  assert.equal(fired[0]!.why, "starts in 7 minutes");
  assert.equal(fired[0]!.rule, "soon");
  assert.equal(matching([rule], [soon], now, undefined, (key) => key === fired[0]!.key).length, 0, "seen is seen");
});

test("an event too far off, already started, untimed or done does not fire", () => {
  const rule: Rule = { id: "soon", when: "event", within: 10, voice: false };
  const items = [
    item("event", "later", "2026-09-17T10:30:00Z"),
    item("event", "started", "2026-09-17T09:59:00Z"),
    item("event", "all day", "2026-09-17", { timed: false }),
    item("event", "done", "2026-09-17T10:05:00Z", { done: true }),
  ];
  assert.equal(matching([rule], items, now, undefined, never).length, 0);
});

test("a message counts only from the last look on, and only if it matches", () => {
  const rule: Rule = { id: "boss", when: "message", matching: "invoice", voice: true };
  const older = item("message", "Invoice 41", "2026-09-17T09:50:00Z");
  const newer = item("message", "INVOICE 42", "2026-09-17T09:58:00Z");
  const other = item("message", "Lunch?", "2026-09-17T09:59:00Z");
  const since = new Date("2026-09-17T09:55:00Z");
  const fired = matching([rule], [older, newer, other], now, since, never);
  assert.deepEqual(fired.map((one) => one.title), ["INVOICE 42"]);
  assert.equal(fired[0]!.voice, true);
});

test("without a last look every matching message counts", () => {
  const rule: Rule = { id: "any", when: "message", voice: false };
  const fired = matching([rule], [item("message", "a", "2026-09-17T01:00:00Z"), item("message", "b", "2026-09-17T02:00:00Z")], now, undefined, never);
  assert.equal(fired.length, 2);
});

test("an overdue task fires and a finished or future one does not", () => {
  const rule: Rule = { id: "late", when: "task", voice: false };
  const items = [
    item("task", "Tax return", "2026-09-10", { timed: false }),
    item("task", "Done", "2026-09-10", { timed: false, done: true }),
    item("task", "Next week", "2026-09-24", { timed: false }),
  ];
  const fired = matching([rule], items, now, undefined, never);
  assert.deepEqual(fired.map((one) => one.title), ["Tax return"]);
  assert.equal(fired[0]!.why, "was due 2026-09-10");
});

// Nothing without a rule may reach the user. This is the whole of the promise ambient presence
// makes, so it is the one thing here stated as a test rather than assumed.
test("nothing fires without a rule for it", () => {
  const items = [
    item("event", "now", "2026-09-17T10:01:00Z"),
    item("message", "hello", "2026-09-17T09:59:00Z"),
    item("task", "late", "2026-09-01", { timed: false }),
  ];
  assert.equal(matching([], items, now, undefined, never).length, 0);
  const eventsOnly: Rule = { id: "e", when: "event", within: 60, voice: false };
  assert.deepEqual(matching([eventsOnly], items, now, undefined, never).map((one) => one.title), ["now"]);
});

test("a firing carries when the thing itself is, so it can be shown as a time later", () => {
  const rule: Rule = { id: "soon", when: "event", within: 10, voice: false };
  const soon = item("event", "Design review", "2026-09-17T10:07:00Z");
  const fired = matching([rule], [soon], now, undefined, never);
  assert.equal(fired[0]!.when, "2026-09-17T10:07:00Z");
});
