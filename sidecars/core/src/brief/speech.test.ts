import assert from "node:assert/strict";
import { test } from "node:test";
import { digest } from "#brief/digest.ts";
import { asSpeech } from "#brief/speech.ts";
import type { Gathered } from "#connect/read.ts";
import type { Item, Kind } from "#connect/source.ts";

const when = new Date(2026, 8, 15, 8, 0);

function item(at: string, title: string, kind: Kind = "task", status?: string): Item {
  return {
    source: "notion",
    kind,
    collection: kind === "event" ? "SEP" : "Assignments",
    title,
    at,
    timed: at.length > 10,
    status,
    done: false,
  };
}

function said(items: Item[], extra: Partial<Gathered> = {}): string {
  return asSpeech(digest(
    { items, read: [], refused: [], unavailable: [], failed: [], ...extra },
    when,
  ));
}

function asked(scope: "today" | "tomorrow" | "everything", items: Item[]): string {
  return asSpeech(
    digest({ items, read: [], refused: [], unavailable: [], failed: [] }, when),
    scope,
  );
}

function timeToday(hour: number, minute = 0): string {
  return new Date(2026, 8, 15, hour, minute).toISOString();
}

test("a day with nothing on says so plainly", () => {
  const speech = said([]);
  assert.match(speech, /Today is Tuesday 15 September\./);
  assert.match(speech, /Nothing is on your calendar today\./);
  assert.match(speech, /You have no unread mail\./);
});

test("today's events are listed with their times", () => {
  const speech = said([
    item(timeToday(9, 30), "BIO215", "event"),
    item(timeToday(14), "CHM118", "event"),
  ]);
  assert.match(speech, /You have BIO215 at 9:30 am and CHM118 at 2 pm\./);
});

test("three or more are separated properly, not run together", () => {
  const speech = said([
    item(timeToday(9), "One", "event"),
    item(timeToday(11), "Two", "event"),
    item(timeToday(14), "Three", "event"),
  ]);
  assert.match(speech, /One at 9 am, Two at 11 am, and Three at 2 pm/);
});

test("a fortnight away is never said to be near", () => {
  const speech = said([item("2026-09-29", "Immunology midterm I")]);
  assert.match(speech, /in 14 days/);
  assert.doesNotMatch(speech, /few days|this weekend|next week/);
});

test("the nearest deadline is named, and the rest are counted", () => {
  const speech = said([
    item("2026-09-23", "Stats midterm I"),
    item("2026-09-29", "Immunology midterm I"),
    item("2026-09-30", "Ecology midterm I"),
  ]);
  assert.match(speech, /3 deadlines are coming up\./);
  assert.match(speech, /The nearest is Stats midterm I Wednesday 23 September, in 8 days\./);
});

test("one deadline is not announced as a count", () => {
  const speech = said([item("2026-09-16", "Problem set 3")]);
  assert.match(speech, /Coming up, Problem set 3 tomorrow\./);
});

test("one sender writing twice is not read out twice", () => {
  const speech = said([
    item(timeToday(7), "New app(s) connected", "message", "Microsoft account team"),
    item(timeToday(8), "New app(s) connected", "message", "Microsoft account team"),
    item(timeToday(9), "Welcome", "message", "Google Cloud"),
  ]);

  assert.match(speech, /You have 3 unread messages: two from Microsoft account team and one from Google Cloud\./);
  assert.equal(speech.match(/Microsoft account team/g)?.length, 1,
    "a name said twice in a row sounds like a fault, not a full inbox");
});

test("unread mail is counted and attributed", () => {
  const speech = said([
    item(timeToday(7), "Welcome", "message", "Google Cloud"),
    item(timeToday(8), "Your policy", "message", "Northwind Insurance"),
  ]);
  assert.match(speech, /You have 2 unread messages, from Google Cloud and Northwind Insurance\./);
});

test("one message is singular", () => {
  const speech = said([item(timeToday(7), "Welcome", "message", "Google Cloud")]);
  assert.match(speech, /You have one unread message, from Google Cloud\./);
});

test("a source that could not be read is admitted, not skipped", () => {
  const speech = said([], { failed: [{ source: "apple_calendar", reason: "not granted" }] });
  assert.match(speech, /I could not check your Mac's calendar\./,
    "a source is named the way a person would name it, not by its identifier");
});

test("overdue work is named with how late it is", () => {
  const speech = said([item("2026-09-12", "Problem set 2")]);
  assert.match(speech, /one thing is overdue: Problem set 2 Saturday 12 September, 3 days ago\./);
});

test("a timed deadline says the time before how far off it is", () => {
  const evening = new Date(2026, 8, 23, 20, 0).toISOString();
  const speech = said([item(evening, "Stats midterm I")]);
  assert.match(speech, /Wednesday 23 September at 8 pm, in 8 days/);
  assert.doesNotMatch(speech, /in 8 days at/);
});

test("asking about tomorrow is answered about tomorrow", () => {
  const speech = asked("tomorrow", [
    item(new Date(2026, 8, 15, 9, 30).toISOString(), "BIO215", "event"),
    item(new Date(2026, 8, 16, 8, 0).toISOString(), "BIO104", "event"),
    item(new Date(2026, 8, 16, 14, 0).toISOString(), "MAT210", "event"),
  ]);

  assert.match(speech, /^Tomorrow is Wednesday 16 September\. You have BIO104 at 8 am and MAT210 at 2 pm\.$/);
  assert.doesNotMatch(speech, /BIO215/, "today's lectures are not what was asked about");
});

test("an empty tomorrow says so without reciting today", () => {
  const speech = asked("tomorrow", [
    item(new Date(2026, 8, 15, 9, 30).toISOString(), "BIO215", "event"),
  ]);
  assert.match(speech, /Tomorrow is Wednesday 16 September, and nothing is on your calendar\./);
  assert.doesNotMatch(speech, /BIO215/);
});

test("asking only about today stops at today", () => {
  const speech = asked("today", [
    item(new Date(2026, 8, 15, 9, 30).toISOString(), "BIO215", "event"),
    item("2026-09-23", "Stats midterm I"),
    item(new Date(2026, 8, 15, 7, 0).toISOString(), "Welcome", "message", "Google Cloud"),
  ]);

  assert.match(speech, /Today is Tuesday 15 September\. You have BIO215 at 9:30 am\./);
  assert.doesNotMatch(speech, /deadline|unread/, "a narrow question gets a narrow answer");
});

test("a general brief still carries everything", () => {
  const speech = asked("everything", [
    item(new Date(2026, 8, 15, 9, 30).toISOString(), "BIO215", "event"),
    item("2026-09-23", "Stats midterm I"),
  ]);
  assert.match(speech, /Today is Tuesday 15 September/);
  assert.match(speech, /Coming up, Stats midterm I/);
  assert.match(speech, /no unread mail/);
});

test("asked about tomorrow, what is due tomorrow is said too", () => {
  const answer = asked("tomorrow", [
    item(new Date(2026, 8, 16, 10, 0).toISOString(), "BIO215", "event"),
    item("2026-09-16", "Problem set 3"),
    item("2026-09-20", "Essay"),
  ]);

  assert.match(answer, /BIO215/);
  assert.match(answer, /Problem set 3/);
  assert.doesNotMatch(answer, /Essay/);
});

test("asked about tomorrow with a calendar out of reach, it does not call the day free", () => {
  const answer = asSpeech(digest(
    { items: [], read: [], refused: [], unavailable: [], failed: [{ source: "apple_calendar", reason: "no access" }] },
    when,
  ), "tomorrow");

  assert.match(answer, /could not check your Mac's calendar/);
  assert.doesNotMatch(answer, /nothing is on your calendar/i);
});
