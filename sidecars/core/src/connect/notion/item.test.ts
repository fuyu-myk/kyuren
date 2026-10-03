import assert from "node:assert/strict";
import { test } from "node:test";
import { itemOf } from "#connect/notion/item.ts";

const finished = new Set(["Done"]);

function page(properties: Record<string, Record<string, unknown>>) {
  return { id: "p", url: "https://notion.so/p", properties };
}

test("a timed entry keeps its time of day", () => {
  const item = itemOf(page({
    Name: { type: "title", title: [{ plain_text: "Cancer midterm I" }] },
    "Due Date": { type: "date", date: { start: "2026-09-29T14:00:00.000-07:00" } },
  }), "Assignments", "Due Date", finished);

  assert.equal(item?.title, "Cancer midterm I");
  assert.equal(item?.timed, true);
  assert.equal(item?.collection, "Assignments");
});

test("a date without a time is not timed", () => {
  const item = itemOf(page({
    Name: { type: "title", title: [{ plain_text: "Read chapter four" }] },
    "Due date": { type: "date", date: { start: "2026-09-15" } },
  }), "Todo List", "Due date", finished);

  assert.equal(item?.timed, false);
  assert.equal(item?.at, "2026-09-15");
});

test("an entry with no date is not an item at all", () => {
  const item = itemOf(page({
    Name: { type: "title", title: [{ plain_text: "Someday" }] },
    "Due date": { type: "date", date: null },
  }), "Todo List", "Due date", finished);

  assert.equal(item, undefined);
});

test("a finished status marks the item done", () => {
  const item = itemOf(page({
    Name: { type: "title", title: [{ plain_text: "Old task" }] },
    "Due date": { type: "date", date: { start: "2026-08-30" } },
    Status: { type: "status", status: { name: "Done" } },
  }), "Todo List", "Due date", finished);

  assert.equal(item?.done, true);
  assert.equal(item?.status, "Done");
});

test("an empty status is not done", () => {
  const item = itemOf(page({
    Name: { type: "title", title: [{ plain_text: "Ecology midterm I" }] },
    "Due Date": { type: "date", date: { start: "2026-09-30T08:00:00.000-07:00" } },
    Status: { type: "status", status: null },
  }), "Assignments", "Due Date", finished);

  assert.equal(item?.done, false);
  assert.equal(item?.status, undefined);
});

test("a ticked checkbox also means done", () => {
  const item = itemOf(page({
    Name: { type: "title", title: [{ plain_text: "Tick me" }] },
    Date: { type: "date", date: { start: "2026-09-15" } },
    Complete: { type: "checkbox", checkbox: true },
  }), "Notes", "Date", finished);

  assert.equal(item?.done, true);
});

test("an untitled entry still reads as something", () => {
  const item = itemOf(page({
    Name: { type: "title", title: [] },
    Date: { type: "date", date: { start: "2026-09-15" } },
  }), "Notes", "Date", finished);

  assert.equal(item?.title, "untitled");
});

test("an exam, a midterm, a quiz or a test happens rather than gets done", () => {
  const titled = (title: string, more: Record<string, Record<string, unknown>> = {}) => itemOf(page({
    Name: { type: "title", title: [{ plain_text: title }] },
    "Due Date": { type: "date", date: { start: "2026-09-29" } },
    ...more,
  }), "Assignments", "Due Date", finished);

  assert.equal(titled("Cancer midterm I")?.happening, true);
  assert.equal(titled("Drug discovery quiz")?.happening, true);
  assert.equal(titled("Final exam")?.happening, true);
  assert.equal(titled("Problem set 1")?.happening, false);
  assert.equal(titled("Final project")?.happening, false, "a final project is work to finish");
  assert.equal(titled("Immunology I", { Type: { type: "select", select: { name: "Exam" } } })?.happening, true, "or its type says so");
});
