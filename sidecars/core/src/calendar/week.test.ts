import assert from "node:assert/strict";
import { test } from "node:test";
import { WeekReader, weekOf, type Week } from "#calendar/week.ts";
import type { Item, Source } from "#connect/source.ts";
import { Gate } from "#permission/gate.ts";
import { localStamp } from "#recap/gather.ts";

const now = new Date(2026, 9, 28, 9, 30);
const local = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).toISOString();

function event(title: string, at: string, source = "apple_calendar", kind: Item["kind"] = "event"): Item {
  return { source, kind, collection: "Home", title, at, timed: at.length > 10, done: false };
}

test("the week is seven days from today, each with its events, those without a time first", () => {
  const days = weekOf(
    [
      event("Standup", local(28, 10)),
      event("Holiday", "2026-10-28"),
      event("Lunch", local(28, 12, 30)),
      event("Yesterday's", local(27, 10)),
      event("Next week", local(4 + 31, 10)),
      event("A task, not an event", local(29, 9), "notion", "task"),
      event("Friday review", local(30, 15)),
    ],
    now,
  );
  assert.deepEqual(days.map((one) => one.day), ["2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03"]);
  assert.deepEqual(days[0]!.events.map((one) => one.title), ["Holiday", "Standup", "Lunch"]);
  assert.deepEqual(days[1]!.events, []);
  assert.deepEqual(days[2]!.events.map((one) => one.title), ["Friday review"]);
});

test("an event two calendars both hold is shown once, whichever way each writes its time", () => {
  const ten = new Date(2026, 9, 28, 10);
  const days = weekOf([event("standup ", ten.toISOString()), event("Standup", localStamp(ten), "google_calendar"), event("Standup", local(28, 15))], now);
  assert.deepEqual(days[0]!.events.map((one) => [one.title, one.at]), [["standup ", ten.toISOString()], ["Standup", local(28, 15)]]);
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
  assert.deepEqual(first.days[0]!.events.map((one) => one.title), ["Standup"]);
  assert.equal(told.length, 1, "what was read is told to the island");

  clock = new Date(now.getTime() + 60_000);
  assert.equal(await reader.week(), first, "held");
  assert.equal(counted.reads, 1);

  const questions: string[] = [];
  const answered = await reader.week(async (action) => {
    questions.push(action.tool);
    return "allow";
  });
  assert.deepEqual(questions, ["google_calendar"], "asked, when someone pressed for it, about the calendar not yet allowed");
  assert.deepEqual(answered.read, ["apple_calendar", "google_calendar"]);
  assert.deepEqual(answered.days[1]!.events.map((one) => one.title), ["Review"]);

  clock = new Date(now.getTime() + 10 * 60_000);
  await reader.week();
  assert.equal(counted.reads, 5, "read again once old, now without a question");
});
