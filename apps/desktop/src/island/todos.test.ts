import assert from "node:assert/strict";
import { test } from "node:test";
import { changesOf, dueOf, entriesOf, formOf, missingSaid, priorityOf, type Todo } from "./todos.ts";
import type { Day } from "./week.ts";

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

const dentist: Todo = { id: "p", text: "Book the dentist", due: new Date(2026, 9, 30, 14, 5).toISOString(), priority: "P1 High", done: false };

test("a todo's editor is filled from it, its time in local time", () => {
  assert.deepEqual(formOf(dentist), { text: "Book the dentist", date: "2026-10-30", time: "14:05", priority: "high" });
  assert.deepEqual(formOf({ id: "q", text: "Read", due: "2026-10-31", done: false }), { text: "Read", date: "2026-10-31", time: "", priority: "" });
});

test("an edit sends only what changed", () => {
  assert.deepEqual(changesOf(dentist, formOf(dentist)), {}, "nothing, and a priority named P1 High is not written as High");
  assert.deepEqual(changesOf(dentist, { ...formOf(dentist), text: "Book the dentist for Friday " }), { text: "Book the dentist for Friday " });
  assert.deepEqual(changesOf(dentist, { ...formOf(dentist), time: "09:00" }), { date: "2026-10-30", time: "09:00" });
  assert.deepEqual(changesOf(dentist, { ...formOf(dentist), date: "", time: "14:05" }), { date: "", time: "" }, "a due day taken away takes its time");
  assert.deepEqual(changesOf(dentist, { ...formOf(dentist), priority: "" }), { priority: "" });
});


test("the todos due on a day take their place among its events, those with no time first, then by when", () => {
  const timed = (title: string, hours: number) => ({ title, at: new Date(2026, 9, 30, hours).toISOString(), timed: true, source: "apple_calendar", collection: "Work" });
  const day: Day = { day: "2026-10-30", events: [{ title: "Holiday", at: "2026-10-30", timed: false, source: "apple_calendar", collection: "Home" }, timed("Lab", 14)] };
  const todos: Todo[] = [
    dentist,
    { id: "a", text: "Hand in the essay", due: "2026-10-30", done: false },
    { id: "b", text: "Morning run", due: new Date(2026, 9, 30, 8).toISOString(), done: false },
    { id: "c", text: "Another day", due: "2026-10-31", done: false },
    { id: "d", text: "Ticked off", due: "2026-10-30", done: true },
    { id: "e", text: "Whenever", done: false },
  ];
  const named = entriesOf(day, todos).map((entry) => ("event" in entry ? entry.event.title : `todo: ${entry.todo.text}`));
  assert.deepEqual(named, ["Holiday", "todo: Hand in the essay", "todo: Morning run", "Lab", "todo: Book the dentist"]);
  assert.deepEqual(entriesOf({ day: "2026-10-29", events: [] }, todos), []);
});
