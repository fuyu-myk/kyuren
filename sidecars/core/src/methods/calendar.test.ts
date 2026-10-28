import assert from "node:assert/strict";
import { test } from "node:test";
import type { Ask } from "#agent/tool.ts";
import type { Week } from "#calendar/week.ts";
import { calendarHandlers } from "#methods/calendar.ts";

test("the week asks about a calendar only when it was pressed for", async () => {
  const given: Array<Ask | undefined> = [];
  const week: Week = { at: 0, days: [], read: [], refused: [], unavailable: [], failed: [] };
  const ask: Ask = async () => "deny";
  const handlers = calendarHandlers({ week: async (asking) => (given.push(asking), week) }, ask);
  await handlers["calendar.week"]({});
  await handlers["calendar.week"]({ ask: "yes" });
  await handlers["calendar.week"]({ ask: true });
  assert.deepEqual(given, [undefined, undefined, ask]);
});
