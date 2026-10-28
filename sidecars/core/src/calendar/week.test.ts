import assert from "node:assert/strict";
import { test } from "node:test";
import { WeekReader, weekOf, type Week } from "#calendar/week.ts";
import type { Item, Source } from "#connect/source.ts";
import { Gate } from "#permission/gate.ts";
import { localStamp } from "#brief/day.ts";

const now = new Date(2026, 9, 28, 9, 30);
const local = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).toISOString();

function event(title: string, at: string, source = "apple_calendar", kind: Item["kind"] = "event"): Item {
  return { source, kind, collection: "Home", title, at, timed: at.length > 10, done: false };
}

test("the week is the calendar week holding today, Sunday to Saturday, each day with its events, those without a time first", () => {
  const week = weekOf(
    [
      event("Standup", local(28, 10)),
      event("Holiday", "2026-10-28"),
      event("Lunch", local(28, 12, 30)),
      event("Monday's", local(26, 10)),
      event("Last week", local(24, 10)),
      event("Next Tuesday", local(31 + 3, 9)),
      event("Too far", local(31 + 9, 9)),
      event("A task, not an event", local(29, 9), "notion", "task"),
      event("Friday review", local(30, 15)),
    ],
    now,
  );
  assert.deepEqual(week.days.map((one) => one.day), ["2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31"]);
  assert.deepEqual(week.days[3]!.events.map((one) => one.title), ["Holiday", "Standup", "Lunch"]);
  assert.deepEqual(week.days[1]!.events.map((one) => one.title), ["Monday's"], "the days already past this week are in it");
  assert.deepEqual(week.days[4]!.events, []);
  assert.deepEqual(week.days[5]!.events.map((one) => one.title), ["Friday review"]);
  assert.deepEqual(week.after.map((one) => one.day), ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"]);
  assert.deepEqual(week.after.flatMap((one) => one.events.map((event) => event.title)), ["Next Tuesday"], "the week after, for what comes next");
});

test("a week may begin on Monday instead, and a Sunday then ends it", () => {
  assert.deepEqual(weekOf([], now, true).days.map((one) => one.day), ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
  const sunday = new Date(2026, 10, 1, 9);
  assert.equal(weekOf([], sunday, true).days[6]!.day, "2026-11-01", "on a Sunday, the week that ends today");
  assert.equal(weekOf([], sunday).days[0]!.day, "2026-11-01", "or the week that begins today");
});

test("an event two calendars both hold is shown once, whichever way each writes its time", () => {
  const ten = new Date(2026, 9, 28, 10);
  const { days } = weekOf([event("standup ", ten.toISOString()), event("Standup", localStamp(ten), "google_calendar"), event("Standup", local(28, 15))], now);
  assert.deepEqual(days[3]!.events.map((one) => [one.title, one.at]), [["standup ", ten.toISOString()], ["Standup", local(28, 15)]]);
});

function calendar(name: string, items: Item[], counted: { reads: number }): Source {
  return {
    name,
    effect: "personal",
    origin: `${name}:local`,
    available: () => true,
    read: async () => {
      counted.reads += 1;
      return items;
    },
  };
}

test("the week read on its own reads only calendars already allowed, and is held for a few minutes", async () => {
  const counted = { reads: 0 };
  const told: Week[] = [];
  const gate = new Gate(() => [], () => undefined);
  const allowed = calendar("apple_calendar", [event("Standup", local(28, 10))], counted);
  const asked = calendar("google_calendar", [event("Review", local(29, 14))], counted);
  gate.remember({ tool: "apple_calendar", effect: "personal", target: "apple_calendar:local" }, "allow");
  let clock = now;
  const reader = new WeekReader(gate, (week) => told.push(week), [allowed, asked], () => clock);

  const first = await reader.week();
  assert.deepEqual(first.read, ["apple_calendar"]);
  assert.deepEqual(first.refused, ["google_calendar"], "not yet allowed, and nobody asked");
  assert.deepEqual(first.days[3]!.events.map((one) => one.title), ["Standup"]);
  assert.equal(told.length, 1, "what was read is told to the island");

  clock = new Date(now.getTime() + 60_000);
  assert.deepEqual(await reader.week(), first, "held");
  assert.equal(told.length, 1, "told only of a new reading");
  assert.equal(counted.reads, 1);

  const questions: string[] = [];
  const answered = await reader.week(async (action) => {
    questions.push(action.tool);
    return "allow";
  });
  assert.deepEqual(questions, ["google_calendar"], "asked, when someone pressed for it, about the calendar not yet allowed");
  assert.deepEqual(answered.read, ["apple_calendar", "google_calendar"]);
  assert.deepEqual(answered.days[4]!.events.map((one) => one.title), ["Review"]);
  const monday = await reader.week(undefined, true);
  assert.deepEqual(monday.days[0]!.day, "2026-10-26", "a week begun on Monday, from the same reading");

  clock = new Date(now.getTime() + 10 * 60_000);
  await reader.week();
  assert.equal(counted.reads, 5, "read again once old, now without a question");
});
