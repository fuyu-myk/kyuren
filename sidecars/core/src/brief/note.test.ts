import assert from "node:assert/strict";
import { test } from "node:test";
import { digest } from "#brief/digest.ts";
import { CLOSE, merge, noteName, OPEN, render } from "#brief/note.ts";
import type { Gathered } from "#connect/read.ts";
import type { Item, Kind } from "#connect/source.ts";

const when = new Date(2026, 8, 15, 8, 0);

function item(at: string, title: string, kind: Kind = "task", url?: string): Item {
  return {
    source: "notion",
    kind,
    collection: kind === "event" ? "SEP" : "Assignments",
    title,
    at,
    timed: at.length > 10,
    done: false,
    url,
  };
}

function note(items: Item[], extra: Partial<Gathered> = {}): string {
  const gathered: Gathered = {
    items, read: ["notion"], refused: [], unavailable: [], failed: [], ...extra,
  };
  return render(digest(gathered, when), gathered.read);
}

test("the note is named for the day it covers", () => {
  assert.equal(noteName("2026-09-15"), "2026-09-15.md");
});

test("a day reads as markdown a person would write", () => {
  const markdown = note([item("2026-09-15", "Reading")]);
  assert.match(markdown, /^# Tuesday 15 September 2026/);
  assert.match(markdown, /## Today/);
  assert.match(markdown, /- Tuesday 15 September — Reading _\(Assignments\)_/);
});

test("a link is named at the foot, not spelled out in the line", () => {
  const markdown = note([item("2026-09-15", "Cancer midterm I", "task", "https://notion.so/x")]);
  assert.match(markdown, /- Tuesday 15 September — \[Cancer midterm I\]\[1\] _\(Assignments\)_/);
  assert.match(markdown, /^\[1\]: https:\/\/notion\.so\/x$/m);
});

test("the same address is numbered once", () => {
  const markdown = note([
    item("2026-09-15", "One", "task", "https://notion.so/same"),
    item("2026-09-15", "Two", "task", "https://notion.so/same"),
  ]);
  assert.match(markdown, /\[One\]\[1\]/);
  assert.match(markdown, /\[Two\]\[1\]/);
  assert.equal(markdown.match(/^\[1\]:/gm)?.length, 1);
});

test("an entry with no address is plain text", () => {
  const markdown = note([item("2026-09-15", "Reading")]);
  assert.match(markdown, /- Tuesday 15 September — Reading _\(Assignments\)_/);
  assert.doesNotMatch(markdown, /\[1\]/);
});

test("empty sections are left out rather than left blank", () => {
  const markdown = note([item("2026-09-15", "Reading")]);
  assert.doesNotMatch(markdown, /## Overdue/);
  assert.doesNotMatch(markdown, /## Unread mail/);
});

test("what was read is stated at the foot", () => {
  assert.match(note([]), /_Read from notion\._/);
});

test("a first reading writes the whole file", () => {
  const written = merge(undefined, "# A day");
  assert.equal(written, `${OPEN}\n# A day\n${CLOSE}\n`);
});

test("reading the day again replaces only what Kyuren wrote", () => {
  const first = merge(undefined, "# First");
  const edited = `${first}\n## My own notes\n\nCall the registrar back.\n`;

  const again = merge(edited, "# Second");
  assert.match(again, /# Second/);
  assert.doesNotMatch(again, /# First/);
  assert.match(again, /Call the registrar back\./, "a hand-written note must survive");
});

test("notes written above the block survive too", () => {
  const edited = `Remember: dentist.\n\n${OPEN}\n# First\n${CLOSE}\n`;
  const again = merge(edited, "# Second");
  assert.match(again, /^Remember: dentist\./);
  assert.match(again, /# Second/);
});

test("a file without the markers is left entirely alone", () => {
  const theirs = "# My own day\n\nI wrote this myself.\n";
  assert.equal(merge(theirs, "# Kyuren's version"), theirs,
    "a file Kyuren did not write is not a file Kyuren may overwrite");
});

test("the note groups mail by sender and says when there was more than one", () => {
  const markdown = note([
    { source: "gmail", kind: "message", collection: "Inbox", title: "New app(s) connected",
      at: "2026-09-15T07:00:00Z", timed: true, status: "Microsoft account team", done: false },
    { source: "gmail", kind: "message", collection: "Inbox", title: "New app(s) connected",
      at: "2026-09-15T08:00:00Z", timed: true, status: "Microsoft account team", done: false },
  ]);

  assert.match(markdown, /- \*\*Microsoft account team\*\* — New app\(s\) connected _\(2 in all\)_/);
  assert.equal(markdown.match(/Microsoft account team/g)?.length, 1);
});
