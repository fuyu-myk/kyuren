import assert from "node:assert/strict";
import { test } from "node:test";
import { asFacts, digest } from "#brief/digest.ts";
import type { Gathered } from "#connect/read.ts";
import type { Item, Kind } from "#connect/source.ts";

const when = new Date(2026, 8, 15, 8, 0);

function item(at: string, title: string, kind: Kind = "task", done = false): Item {
  return {
    source: "notion",
    kind,
    collection: kind === "event" ? "SEP" : "Assignments",
    title,
    at,
    timed: at.length > 10,
    done,
  };
}

function gathered(items: Item[], extra: Partial<Gathered> = {}): Gathered {
  return { items, read: ["notion"], refused: [], unavailable: [], failed: [], ...extra };
}

test("an event that has passed is not overdue work", () => {
  const summary = digest(gathered([
    item("2026-09-02", "BIO104", "event"),
    item("2026-09-12", "Problem set 2"),
  ]), when);

  assert.deepEqual(summary.overdue.map((one) => one.title), ["Problem set 2"],
    "a lecture that happened is past, not unfinished");
});

test("everything on today is on today, whatever kind it is", () => {
  const summary = digest(gathered([
    item("2026-09-15", "BIO215", "event"),
    item("2026-09-15", "Reading"),
    item("2026-09-15T09:00:00Z", "A message", "message"),
  ]), when);

  assert.deepEqual(summary.now.map((one) => one.title).sort(), ["BIO215", "Reading"]);
  assert.deepEqual(summary.messages.map((one) => one.title), ["A message"]);
});

test("only the next day of events is mentioned, not the whole timetable", () => {
  const summary = digest(gathered([
    item("2026-09-16", "BIO104", "event"),
    item("2026-09-17", "BIO215", "event"),
    item("2026-09-25", "MAT210", "event"),
  ]), when);

  assert.deepEqual(summary.tomorrow.map((one) => one.title), ["BIO104"]);
});

test("deadlines are carried the whole way out, because they are the news", () => {
  const summary = digest(gathered([
    item("2026-09-23", "Stats midterm I"),
    item("2026-09-30", "Ecology midterm I"),
  ]), when);

  assert.deepEqual(summary.deadlines.map((one) => one.title),
    ["Stats midterm I", "Ecology midterm I"]);
  assert.deepEqual(summary.tomorrow, []);
});

test("finished work is never mentioned", () => {
  const summary = digest(gathered([
    item("2026-09-12", "Problem set 1", "task", true),
    item("2026-09-12", "Problem set 2"),
  ]), when);

  assert.deepEqual(summary.overdue.map((one) => one.title), ["Problem set 2"]);
});

test("an empty day says so rather than saying nothing", () => {
  const facts = asFacts(digest(gathered([]), when));
  assert.match(facts, /Nothing is on today/);
  assert.match(facts, /Today is Tuesday 15 September/);
});

test("what could not be read is stated, not hidden", () => {
  const facts = asFacts(digest(
    gathered([], { refused: ["apple_mail"], failed: [{ source: "google", reason: "401 expired" }] }),
    when,
  ));

  assert.match(facts, /apple_mail was not allowed/);
  assert.match(facts, /google could not be reached: 401 expired/);
});

test("a timed entry is given its time and an all-day entry is not", () => {
  const evening = new Date(2026, 8, 23, 20, 0).toISOString();
  const facts = asFacts(digest(gathered([
    item(evening, "Stats midterm I"),
    item("2026-09-15", "Reading"),
  ]), when));

  assert.match(facts, /Wednesday 23 September at 8 pm, in 8 days: Stats midterm I/);
  assert.match(facts, /- Tuesday 15 September, today: Reading/);
});

test("an empty inbox is stated, so the model cannot invent one", () => {
  const facts = asFacts(digest(gathered([]), when));
  assert.match(facts, /No unread mail\./);
});

test("the number of unread messages is given, not left to be counted", () => {
  const facts = asFacts(digest(gathered([
    item("2026-09-15T09:00:00Z", "One", "message"),
    item("2026-09-15T10:00:00Z", "Two", "message"),
  ]), when));
  assert.match(facts, /Unread mail, 2 messages:/);
});

test("asked about tomorrow, the facts are tomorrow's alone, and say what could not be checked", () => {
  const summary = digest(gathered([
    item(new Date(2026, 8, 16, 10, 0).toISOString(), "BIO215", "event"),
    item("2026-09-16", "Problem set 3"),
    item("2026-09-12", "Problem set 2"),
    item("2026-09-20", "Essay"),
    item("2026-09-15T09:00:00Z", "A message", "message"),
  ], { failed: [{ source: "apple_calendar", reason: "no access" }] }), when);

  const facts = asFacts(summary, "tomorrow");
  assert.match(facts, /BIO215/);
  assert.match(facts, /Problem set 3/, "what is due tomorrow is part of tomorrow");
  assert.doesNotMatch(facts, /Problem set 2|Essay|A message|Overdue|Unread mail/, "and nothing else is");
  assert.match(facts, /apple_calendar could not be reached/);
});

test("asked about today, the facts are today's alone", () => {
  const summary = digest(gathered([
    item("2026-09-15", "Reading"),
    item("2026-09-12", "Problem set 2"),
    item("2026-09-15T09:00:00Z", "A message", "message"),
  ]), when);

  const facts = asFacts(summary, "today");
  assert.match(facts, /Reading/);
  assert.doesNotMatch(facts, /Problem set 2|A message/);
  assert.match(asFacts(summary), /Problem set 2/, "a whole brief still has everything");
});

test("an exam that has been sat is past, not overdue work", () => {
  const summary = digest(gathered([
    { ...item("2026-09-10", "Stats midterm I"), happening: true },
    item("2026-09-12", "Problem set 2"),
    { ...item("2026-09-20", "Cancer midterm II"), happening: true },
  ]), when);

  assert.deepEqual(summary.overdue.map((one) => one.title), ["Problem set 2"]);
  assert.deepEqual(summary.deadlines.map((one) => one.title), ["Cancer midterm II"], "one still to come is still a deadline");
});
