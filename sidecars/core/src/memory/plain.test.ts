import assert from "node:assert/strict";
import { test } from "node:test";
import { plainly } from "#memory/plain.ts";

test("a reference link keeps its words and loses its number", () => {
  assert.equal(
    plainly("- Wednesday 23 September, 8 pm — [Stats midterm I][4] _(SEP)_"),
    "Wednesday 23 September, 8 pm — Stats midterm I (SEP)",
  );
});

test("a link definition is not words at all", () => {
  const note = "Read this.\n\n[1]: https://example.com/a/very/long/address?with=parameters\n";
  assert.equal(plainly(note), "Read this.");
});

test("an inline link keeps its words", () => {
  assert.equal(plainly("See [the syllabus](https://example.com/x) for detail."),
    "See the syllabus for detail.");
});

test("headings and bullets read as sentences", () => {
  assert.equal(plainly("## Deadlines\n\n- One\n- Two\n"), "Deadlines\n\nOne\nTwo");
});

test("emphasis is removed and the word kept", () => {
  assert.equal(plainly("This is **important** and _urgent_."), "This is important and urgent.");
});

test("a word with an underscore in it is left alone", () => {
  assert.equal(plainly("The file is apple_calendar and it failed."),
    "The file is apple_calendar and it failed.");
});

test("code is not indexed as prose", () => {
  assert.equal(plainly("Try this:\n\n```\nrm -rf /\n```\n\nAfterwards."), "Try this:\n\nAfterwards.");
  assert.equal(plainly("Run `pnpm test` first."), "Run pnpm test first.");
});

test("plain prose is untouched", () => {
  assert.equal(plainly("Petra is my lab partner."), "Petra is my lab partner.");
});

test("a wiki link reads as the name it points at", () => {
  assert.equal(plainly("Taught by [[Professor Delgado]]."), "Taught by Professor Delgado.");
  assert.equal(plainly("See [[Immunology|the course note]]."), "See the course note.");
  assert.equal(plainly("See [[Immunology#Midterm]]."), "See Immunology.");
});
