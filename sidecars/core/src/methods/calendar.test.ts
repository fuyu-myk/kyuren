import assert from "node:assert/strict";
import { test } from "node:test";
import type { Ask } from "#agent/tool.ts";
import type { Week } from "#calendar/week.ts";
import { calendarHandlers } from "#methods/calendar.ts";

test("the week asks about a calendar only when it was pressed for, and begins on Monday only when told to", async () => {
  const given: Array<[Ask | undefined, boolean | undefined]> = [];
  const week: Week = { at: 0, days: [], after: [], read: [], refused: [], unavailable: [], failed: [] };
  const ask: Ask = async () => "deny";
  const handlers = calendarHandlers({ week: async (asking, monday) => (given.push([asking, monday]), week) }, ask);
  await handlers["calendar.week"]({});
  await handlers["calendar.week"]({ ask: "yes", monday: "yes" });
  await handlers["calendar.week"]({ ask: true, monday: true });
  assert.deepEqual(given, [[undefined, false], [undefined, false], [ask, true]]);
});
