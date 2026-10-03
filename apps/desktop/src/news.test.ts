import assert from "node:assert/strict";
import { test } from "node:test";
import type { Firing } from "./ambient.ts";
import { clockOf, nextOf, sayingOf, stillWorth } from "./news.ts";

const meeting: Firing = {
  rule: "meeting-soon", voice: false, title: "BIO215 discussion", why: "starts in 8 minutes",
  at: "2026-09-18T19:52:19.203Z", when: "2026-09-18T13:00:00-07:00",
};
const mail: Firing = { rule: "invoice-mail", voice: true, title: "Invoice 42", why: "arrived", at: "2026-09-18T19:52:19.203Z" };

test("a meeting notice leaves the front page an hour after the meeting began", () => {
  const began = Date.parse(meeting.when!);
  assert.equal(stillWorth(meeting, began - 8 * 60_000), true, "eight minutes before");
  assert.equal(stillWorth(meeting, began + 30 * 60_000), true, "half an hour in");
  assert.equal(stillWorth(meeting, began + 61 * 60_000), false, "an hour on it is history");
});

test("anything else stays a day", () => {
  const fired = Date.parse(mail.at);
  assert.equal(stillWorth(mail, fired + 23 * 3600_000), true);
  assert.equal(stillWorth(mail, fired + 25 * 3600_000), false);
});

test("a meeting is shown by its own time, and its stale phrase is dropped", () => {
  assert.equal(sayingOf(meeting), "");
  assert.equal(sayingOf(mail), "arrived, spoken");
  assert.match(clockOf(meeting), /^\d\d:\d\d$/);
});


test("when something is next due is said as today's time, or the day and time", () => {
  const monday = new Date(2026, 8, 21, 7, 30);
  assert.equal(nextOf(monday.toISOString(), new Date(2026, 8, 21, 6, 0).getTime()), "today 07:30");
  assert.equal(nextOf(monday.toISOString(), new Date(2026, 8, 18, 10, 0).getTime()), "mon 07:30");
});
