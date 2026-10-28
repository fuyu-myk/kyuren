import assert from "node:assert/strict";
import { test } from "node:test";
import { localStamp } from "#brief/day.ts";
import { addingOf, doneProperties, editingOf, editProperties, noteBlocks, openFilter, propertiesFor, shapeOf, todoOf, type Shape } from "#connect/notion/todos.ts";
import type { Schema } from "#connect/notion/schema.ts";

const statusSchema: Schema = {
  Name: { type: "title" },
  Due: { type: "date" },
  priority: { type: "select", select: { options: [{ name: "P1 High" }, { name: "high" }, { name: "Low" }] } },
  State: {
    type: "status",
    status: {
      options: [{ id: "1", name: "Not started" }, { id: "2", name: "Doing" }, { id: "3", name: "Done" }, { id: "4", name: "Dropped" }],
      groups: [{ name: "To-do", option_ids: ["1"] }, { name: "In progress", option_ids: ["2"] }, { name: "Complete", option_ids: ["3", "4"] }],
    },
  },
};

const checkboxSchema: Schema = { Task: { type: "title" }, Finished: { type: "checkbox" } };

test("a database's shape is read from its own properties: its title, date, priority and how it says done", () => {
  assert.deepEqual(shapeOf(statusSchema), {
    title: "Name",
    date: "Due",
    priority: { property: "priority", options: ["P1 High", "high", "Low"] },
    status: { property: "State", done: "Done", open: "Not started", finished: ["Done", "Dropped"] },
  });
  assert.deepEqual(shapeOf(checkboxSchema), { title: "Task", checkbox: "Finished" });
  assert.equal(shapeOf({ Due: { type: "date" } }), undefined, "nothing to write a todo's words in");
});

test("only what is not done is asked for", () => {
  const status = shapeOf(statusSchema)!;
  assert.deepEqual(openFilter(status), { and: [{ property: "State", status: { does_not_equal: "Done" } }, { property: "State", status: { does_not_equal: "Dropped" } }] });
  assert.deepEqual(openFilter(shapeOf(checkboxSchema)!), { property: "Finished", checkbox: { equals: false } });
  assert.equal(openFilter({ title: "Name" }), undefined);
});

test("a page reads as a todo: its words, when it is due, its priority and whether it is done", () => {
  const shape = shapeOf(statusSchema)!;
  const page = {
    id: "p1",
    url: "https://www.notion.so/p1",
    properties: {
      Name: { type: "title", title: [{ plain_text: "Book " }, { plain_text: "the dentist" }] },
      Due: { type: "date", date: { start: "2026-10-30T14:00:00.000+08:00" } },
      priority: { type: "select", select: { name: "high" } },
      State: { type: "status", status: { name: "Doing" } },
    },
  };
  assert.deepEqual(todoOf(page, shape), { id: "p1", text: "Book the dentist", due: "2026-10-30T14:00:00.000+08:00", priority: "high", done: false, url: "https://www.notion.so/p1" });
  assert.equal(todoOf({ id: "p2", properties: { Name: { type: "title", title: [] }, State: { type: "status", status: { name: "Dropped" } } } }, shape).done, true);
  assert.equal(todoOf({ id: "p3", properties: {} }, shape).text, "untitled");
});

test("what is added is checked at the edge: one line of words, a real date, a time only with one, a known priority", () => {
  assert.deepEqual(addingOf({ text: "  Book the dentist ", date: "2026-10-30", time: "14:05", priority: "high", note: "Ask about\nthe crown" }), {
    text: "Book the dentist",
    date: "2026-10-30",
    time: "14:05",
    priority: "high",
    note: "Ask about\nthe crown",
  });
  assert.deepEqual(addingOf({ text: "Read", date: "", time: "", priority: "", note: "" }), { text: "Read" }, "empty fields are none");
  for (const wrong of [
    { text: "" },
    { text: "two\nlines" },
    { text: "a".repeat(201) },
    { text: "x", date: "2026-02-30" },
    { text: "x", date: "30/10/2026" },
    { text: "x", time: "14:00" },
    { text: "x", date: "2026-10-30", time: "25:00" },
    { text: "x", priority: "urgent" },
    { text: "x", note: "a".repeat(2001) },
    { text: "x", note: "bell\u0007" },
    { text: 7 },
  ]) {
    assert.throws(() => addingOf(wrong as Record<string, unknown>), Error, JSON.stringify(wrong));
  }
});

test("a todo is written with its date, its time in local time, and its priority as the database names it", () => {
  const shape = shapeOf(statusSchema)!;
  assert.deepEqual(propertiesFor({ text: "Book the dentist", date: "2026-10-30", time: "14:05", priority: "high" }, shape), {
    Name: { title: [{ text: { content: "Book the dentist" } }] },
    Due: { date: { start: localStamp(new Date(2026, 9, 30, 14, 5)) } },
    priority: { select: { name: "high" } },
  });
  assert.deepEqual(propertiesFor({ text: "Read", date: "2026-10-30", priority: "medium" }, shape), {
    Name: { title: [{ text: { content: "Read" } }] },
    Due: { date: { start: "2026-10-30" } },
    priority: { select: { name: "Medium" } },
  });
  assert.deepEqual(propertiesFor({ text: "Read", date: "2026-10-30", priority: "low" }, shapeOf(checkboxSchema)!), { Task: { title: [{ text: { content: "Read" } }] } }, "what the database has no place for is left out");
});

test("a todo is ticked off as the database says done, and on again as it says to do", () => {
  const status = shapeOf(statusSchema)!;
  assert.deepEqual(doneProperties(status, true), { State: { status: { name: "Done" } } });
  assert.deepEqual(doneProperties(status, false), { State: { status: { name: "Not started" } } });
  assert.deepEqual(doneProperties(shapeOf(checkboxSchema)!, true), { Finished: { checkbox: true } });
  assert.equal(doneProperties({ title: "Name" } as Shape, true), undefined);
});

test("a note is written as the page's own text, a paragraph a line", () => {
  assert.deepEqual(noteBlocks("Ask about\nthe crown\n"), [
    { object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: "Ask about" } }] } },
    { object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: "the crown" } }] } },
  ]);
  assert.deepEqual(noteBlocks(undefined), []);
});

test("an edit is checked at the edge, and says only what changes: none, words, a due day cleared or moved, a priority", () => {
  assert.deepEqual(editingOf({ id: "x" }), {});
  assert.deepEqual(editingOf({ text: " Book the dentist ", date: null, time: null, priority: null }), { text: "Book the dentist" });
  assert.deepEqual(editingOf({ date: "", time: "" }), { due: null });
  assert.deepEqual(editingOf({ date: "2026-10-30", time: "09:15", priority: "low" }), { due: { date: "2026-10-30", time: "09:15" }, priority: "low" });
  assert.deepEqual(editingOf({ priority: "" }), { priority: null });
  for (const wrong of [{ text: "" }, { text: "two\nlines" }, { date: "tomorrow" }, { date: "", time: "09:15" }, { priority: "urgent" }]) {
    assert.throws(() => editingOf(wrong), Error, JSON.stringify(wrong));
  }
});

test("an edit writes what changes where the database keeps it, a cleared one emptied", () => {
  const shape = shapeOf(statusSchema)!;
  assert.deepEqual(editProperties({ text: "Read", due: { date: "2026-10-30", time: "09:15" }, priority: "high" }, shape), {
    Name: { title: [{ text: { content: "Read" } }] },
    Due: { date: { start: localStamp(new Date(2026, 9, 30, 9, 15)) } },
    priority: { select: { name: "high" } },
  });
  assert.deepEqual(editProperties({ due: null, priority: null }, shape), { Due: { date: null }, priority: { select: null } });
  assert.deepEqual(editProperties({ due: { date: "2026-10-30" }, priority: "low" }, shapeOf(checkboxSchema)!), {}, "what the database has no place for is left out");
});
