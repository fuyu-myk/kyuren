import assert from "node:assert/strict";
import { test } from "node:test";
import { clockOf, dayName, nextEvent, sourceNames, todayOf, until, type Week } from "./week.ts";

const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).toISOString();
const now = new Date(2026, 9, 28, 9, 30).getTime();

const week: Week = {
  at: now,
  days: [
    {
      day: "2026-10-28",
      events: [
        { title: "Holiday", at: "2026-10-28", timed: false, source: "apple_calendar", collection: "Home" },
        { title: "Standup", at: at(28, 9), timed: true, source: "apple_calendar", collection: "Work" },
        { title: "Review", at: at(28, 14), timed: true, source: "google_calendar", collection: "Work" },
      ],
    },
    { day: "2026-10-29", events: [{ title: "Dentist", at: at(29, 8, 15), timed: true, source: "apple_calendar", collection: "Home" }] },
  ],
  after: [{ day: "2026-11-02", events: [{ title: "Planning", at: new Date(2026, 10, 2, 9).toISOString(), timed: true, source: "apple_calendar", collection: "Work" }] }],
  read: ["apple_calendar"],
  refused: ["google_calendar"],
  unavailable: [],
  failed: [],
};

test("the next event is the first with a time still ahead, passing over what started and what has no time", () => {
  assert.equal(nextEvent(week, now)?.title, "Review");
  assert.equal(nextEvent(week, new Date(2026, 9, 28, 15).getTime())?.title, "Dentist");
  assert.equal(nextEvent(week, new Date(2026, 9, 30).getTime())?.title, "Planning", "next week's, with nothing left in this one");
  assert.equal(nextEvent(week, new Date(2026, 10, 3).getTime()), undefined);
  assert.equal(nextEvent(null, now), undefined);
});

test("the next event is counted down in minutes, then hours, and named by its day beyond today", () => {
  assert.equal(until(at(28, 9, 31), now), "in 1 min");
  assert.equal(until(at(28, 10, 12), now), "in 42 min");
  assert.equal(until(at(28, 14), now), "in 4 h 30 min");
  assert.equal(until(at(28, 11, 30), now), "in 2 h");
  assert.equal(until(at(29, 8, 15), now), "tomorrow");
  assert.equal(until(at(31, 10), now), "on Saturday");
  assert.equal(until(at(28, 9, 30), now), "now");
  assert.equal(until(new Date(now + 42 * 60_000 + 5_000).toISOString(), now), "in 42 min", "a few seconds over is not another minute");
  assert.equal(until(new Date(now + 10_000).toISOString(), now), "in 1 min");
});

test("a day is named as the week reads, and a time as a clock does", () => {
  assert.equal(todayOf(now), "2026-10-28");
  assert.equal(dayName("2026-10-28", "2026-10-28"), "today");
  assert.equal(dayName("2026-10-29", "2026-10-28"), "tomorrow");
  assert.equal(dayName("2026-10-31", "2026-10-28"), "Sat 31");
  assert.equal(clockOf(at(28, 14)), "2 pm");
  assert.equal(clockOf(at(28, 9, 5)), "9:05 am");
  assert.equal(clockOf(at(28, 0, 30)), "12:30 am");
});

test("a calendar is named as the user knows it", () => {
  assert.equal(sourceNames(["apple_calendar", "google_calendar", "microsoft_calendar", "notion", "other"]), "Calendar, Google Calendar, Outlook, Notion and other");
});
