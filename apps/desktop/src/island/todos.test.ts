import assert from "node:assert/strict";
import { test } from "node:test";
import { dueOf, missingSaid, priorityOf } from "./todos.ts";

const now = new Date(2026, 9, 28, 9, 30).getTime();

test("a todo's due day is named as the week names days, with its time, and said to be overdue once passed", () => {
  assert.deepEqual(dueOf("2026-10-28", now), { said: "today", overdue: false });
  assert.deepEqual(dueOf("2026-10-27", now), { said: "Tue 27", overdue: true });
  assert.deepEqual(dueOf(new Date(2026, 9, 29, 14, 5).toISOString(), now), { said: "tomorrow 2:05 pm", overdue: false });
  assert.deepEqual(dueOf(new Date(2026, 9, 28, 9).toISOString(), now), { said: "today 9 am", overdue: true });
  assert.equal(dueOf(undefined, now), undefined);
});

test("a priority is read as high, medium or low however the database names it", () => {
  assert.equal(priorityOf("P1 High"), "high");
  assert.equal(priorityOf("Low"), "low");
  assert.equal(priorityOf("Someday"), undefined);
  assert.equal(priorityOf(undefined), undefined);
});

test("with no todos to show, the page says why and where to go", () => {
  assert.match(missingSaid("unchosen"), /Choose a Notion database for todos in System settings/);
  assert.match(missingSaid("unconnected"), /Connect Notion/);
});
