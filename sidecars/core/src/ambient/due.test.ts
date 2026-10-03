import assert from "node:assert/strict";
import { test } from "node:test";
import { dueBetween, keyOf, nextDue } from "#ambient/due.ts";
import type { Schedule } from "#ambient/rules.ts";

// The machine's own clock throughout, since that is the clock a schedule is written in.
function at(year: number, month: number, day: number, hours: number, minutes: number): Date {
  return new Date(year, month - 1, day, hours, minutes);
}

// 2026-09-21 is a Monday.
const review: Schedule = { id: "monday-review", playbook: "weekly-review", at: "07:30", on: ["mon"], inputs: {}, pane: "chat", voice: false };
const daily: Schedule = { id: "morning", playbook: "weekly-review", at: "07:30", inputs: {}, pane: "chat", voice: false };

test("a schedule is next due at its time on the next day it names", () => {
  assert.equal(nextDue(review, at(2026, 9, 18, 10, 0)).getTime(), at(2026, 9, 21, 7, 30).getTime(), "Friday looks to Monday");
  assert.equal(nextDue(review, at(2026, 9, 21, 7, 30)).getTime(), at(2026, 9, 28, 7, 30).getTime(), "on the stroke, the next is a week on");
  assert.equal(nextDue(daily, at(2026, 9, 21, 7, 29)).getTime(), at(2026, 9, 21, 7, 30).getTime());
  assert.equal(nextDue(daily, at(2026, 9, 21, 7, 31)).getTime(), at(2026, 9, 22, 7, 30).getTime());
});

test("what came due between two looks is found once, and not on a day the schedule does not name", () => {
  const found = dueBetween([review, daily], at(2026, 9, 21, 7, 29), at(2026, 9, 21, 7, 30));
  assert.deepEqual(found.map((one) => one.schedule.id), ["monday-review", "morning"]);
  assert.equal(found[0]!.due.getTime(), at(2026, 9, 21, 7, 30).getTime());
  assert.deepEqual(dueBetween([review, daily], at(2026, 9, 21, 7, 30), at(2026, 9, 21, 7, 31)), [], "the next minute finds nothing new");
  assert.deepEqual(dueBetween([review], at(2026, 9, 22, 7, 29), at(2026, 9, 22, 7, 31)), [], "Tuesday is not Monday");
});

test("a time slept through is honoured for a while, then let go", () => {
  assert.equal(dueBetween([daily], at(2026, 9, 21, 7, 0), at(2026, 9, 21, 7, 55)).length, 1, "twenty five minutes late still runs");
  assert.deepEqual(dueBetween([daily], at(2026, 9, 21, 7, 0), at(2026, 9, 21, 8, 5)), [], "thirty five minutes late does not");
});

test("before any look, only what is due within that same while counts", () => {
  assert.equal(dueBetween([daily], undefined, at(2026, 9, 21, 7, 40)).length, 1);
  assert.equal(dueBetween([daily], undefined, at(2026, 9, 21, 9, 0)).length, 0);
});

test("a moment just after midnight can belong to the day before", () => {
  const late: Schedule = { ...daily, at: "23:50" };
  assert.equal(dueBetween([late], at(2026, 9, 21, 23, 49), at(2026, 9, 22, 0, 5)).length, 1);
});

test("a key names the schedule and the moment, so one moment runs once", () => {
  assert.equal(keyOf(daily, at(2026, 9, 21, 7, 30)), keyOf(daily, at(2026, 9, 21, 7, 30)));
  assert.notEqual(keyOf(daily, at(2026, 9, 21, 7, 30)), keyOf(daily, at(2026, 9, 22, 7, 30)));
  assert.notEqual(keyOf(daily, at(2026, 9, 21, 7, 30)), keyOf(review, at(2026, 9, 21, 7, 30)));
});
