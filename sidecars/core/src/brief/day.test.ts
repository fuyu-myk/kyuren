import assert from "node:assert/strict";
import { test } from "node:test";
import { clock, dayOf, distance, spoken, today } from "#brief/day.ts";

test("a bare date is already a day", () => {
  assert.equal(dayOf("2026-09-15"), "2026-09-15");
});

test("a timestamp is placed on the day the clock here shows", () => {
  const at = "2026-09-29T14:00:00.000-07:00";
  const expected = new Date(at);
  const month = `${expected.getMonth() + 1}`.padStart(2, "0");
  const date = `${expected.getDate()}`.padStart(2, "0");
  assert.equal(dayOf(at), `${expected.getFullYear()}-${month}-${date}`);
});

test("today is the local day, not the UTC one", () => {
  const lateEvening = new Date(2026, 8, 15, 23, 30);
  assert.equal(today(lateEvening), "2026-09-15");
});

test("an unparseable date degrades to its leading characters", () => {
  assert.equal(dayOf("not-a-date-at-all"), "not-a-date");
});

test("days are spoken the way they are said", () => {
  assert.equal(spoken("2026-09-15"), "Tuesday 15 September");
  assert.equal(spoken("2026-01-01"), "Thursday 1 January");
});

test("times read as a clock, and all-day entries have none", () => {
  assert.equal(clock("2026-09-15"), undefined);
  const morning = new Date(2026, 8, 15, 9, 30).toISOString();
  assert.equal(clock(morning), "9:30 am");
  const noon = new Date(2026, 8, 15, 12, 0).toISOString();
  assert.equal(clock(noon), "12 pm");
  const evening = new Date(2026, 8, 15, 20, 0).toISOString();
  assert.equal(clock(evening), "8 pm");
});

test("how far away a day is, said the way a person would say it", () => {
  assert.equal(distance("2026-09-15", "2026-09-15"), "today");
  assert.equal(distance("2026-09-16", "2026-09-15"), "tomorrow");
  assert.equal(distance("2026-09-14", "2026-09-15"), "yesterday");
  assert.equal(distance("2026-09-23", "2026-09-15"), "in 8 days");
  assert.equal(distance("2026-09-29", "2026-09-15"), "in 14 days",
    "a fortnight must not be describable as a few days");
  assert.equal(distance("2026-09-01", "2026-09-15"), "14 days ago");
});

test("distance survives the end of a month", () => {
  assert.equal(distance("2026-10-01", "2026-09-30"), "tomorrow");
  assert.equal(distance("2026-10-05", "2026-09-30"), "in 5 days");
});
