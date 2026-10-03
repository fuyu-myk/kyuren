import assert from "node:assert/strict";
import { test } from "node:test";
import { inputsFor, inputsFrom, isoWeek, slugOf } from "#playbook/invoke.ts";
import { parsePlaybook } from "#playbook/shape.ts";

const BOOK = parsePlaybook(`---
name: research
when: the user asks Kyuren to research a question
inputs:
  - question: the question
  - slug: a file name
skills: [web_search]
version: 1
author: test
---

## Steps

1. Look.

## Proof

1. file exists: ~/research/{{slug}}.md
`);

test("the words after the command are the first input, and a slug is made from them", () => {
  const inputs = inputsFrom(BOOK, "How do Kalman filters handle noise?");
  assert.equal(inputs.question, "How do Kalman filters handle noise?");
  assert.equal(inputs.slug, "how-do-kalman-filters-handle-noise");
});

test("a command with nothing after it says what it needs", () => {
  assert.throws(() => inputsFrom(BOOK, "   "), /needs question/);
});

test("an input that cannot be derived is asked for by name", () => {
  const book = { ...BOOK, inputs: [...BOOK.inputs, { name: "tin", about: "which tin" }] };
  assert.throws(() => inputsFrom(book, "cake"), /also needs tin: which tin/);
});

test("slugs and weeks come out as file names and ISO weeks", () => {
  assert.equal(slugOf("Émilie's notes, week 7!"), "émilie-s-notes-week-7");
  assert.equal(slugOf("!!!"), "note");
  assert.equal(isoWeek(new Date(2026, 8, 18)), "2026-W38");
  assert.equal(isoWeek(new Date(2027, 0, 1)), "2026-W53");
});


const WEEKLY = parsePlaybook(`---
name: weekly-review
when: the user asks for a weekly review
inputs:
  - week: the week being reviewed
skills: [remember]
version: 1
author: test
---

## Steps

1. Look back.

## Proof

1. file exists: ~/reviews/{{week}}.md
`);

test("inputs given by name are taken and the rest derived, for a run nobody typed", () => {
  const inputs = inputsFor(BOOK, { question: "How do Kalman filters handle noise?" });
  assert.equal(inputs.question, "How do Kalman filters handle noise?");
  assert.equal(inputs.slug, "how-do-kalman-filters-handle-noise");
  assert.equal(inputsFor(BOOK, { question: "x", slug: "chosen" }).slug, "chosen", "what is given wins");
  assert.throws(() => inputsFor(BOOK, {}), /research needs question/);

  const monday = new Date(2026, 8, 21, 7, 30);
  assert.equal(inputsFor(WEEKLY, {}, monday).week, isoWeek(monday), "a week needs nobody to say it");
});
