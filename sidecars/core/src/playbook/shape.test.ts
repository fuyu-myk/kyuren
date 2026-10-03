import assert from "node:assert/strict";
import { test } from "node:test";
import { approvable, parsePlaybook } from "#playbook/shape.ts";

const SAMPLE = `---
name: weekly-review
when: the user asks for a weekly review, or what happened this week
inputs:
  - week: the ISO week, or this week
skills: [remember, write_file]
version: 3
author: claude-opus-5 on 2026-09-18
approved: fuyu on 2026-09-18
---

## Steps

1. Recall every note changed in {{week}} with remember.
2. Write the review to ~/.kyuren/vault/reviews/{{week}}.md
   with a Themes heading.

## Proof

1. file exists: ~/.kyuren/vault/reviews/{{week}}.md
2. contains: ~/.kyuren/vault/reviews/{{week}}.md :: ## Themes
3. judged: the review names every person mentioned that week

## Notes

- 2026-09-17: the review missed a connected vault; step 1 now says every vault.
`;

test("a playbook is read back whole: what it is for, how it is done, and what done looks like", () => {
  const book = parsePlaybook(SAMPLE);
  assert.equal(book.name, "weekly-review");
  assert.equal(book.when, "the user asks for a weekly review, or what happened this week");
  assert.deepEqual(book.inputs, [{ name: "week", about: "the ISO week, or this week" }]);
  assert.deepEqual(book.skills, ["remember", "write_file"]);
  assert.equal(book.version, 3);
  assert.equal(book.author, "claude-opus-5 on 2026-09-18");
  assert.equal(book.approved, "fuyu on 2026-09-18");
  assert.equal(book.steps.length, 2);
  assert.ok(book.steps[1]?.includes("with a Themes heading"), "a step that runs on is one step");
  assert.deepEqual(book.proof.map((one) => one.kind), ["file", "contains", "judged"]);
  assert.deepEqual(book.notes, ["2026-09-17: the review missed a connected vault; step 1 now says every vault."]);
});

test("a playbook without a proof is not a playbook", () => {
  const noProof = SAMPLE.replace(/## Proof[\s\S]*## Notes/, "## Notes");
  assert.throws(() => parsePlaybook(noProof), /proof/);
  const noSteps = SAMPLE.replace(/## Steps[\s\S]*## Proof/, "## Proof");
  assert.throws(() => parsePlaybook(noSteps), /steps/);
  assert.throws(() => parsePlaybook(SAMPLE.replace("name: weekly-review\n", "")), /name/);
});

test("a proof the model could talk itself past is not approvable", () => {
  const allJudged = SAMPLE.replace("1. file exists: ~/.kyuren/vault/reviews/{{week}}.md\n", "").replace(
    "2. contains: ~/.kyuren/vault/reviews/{{week}}.md :: ## Themes\n",
    "",
  );
  assert.equal(approvable(parsePlaybook(allJudged)).ok, false);
  assert.equal(approvable(parsePlaybook(SAMPLE)).ok, true);
});

test("an unapproved playbook says so", () => {
  const pending = parsePlaybook(SAMPLE.replace("approved: fuyu on 2026-09-18\n", ""));
  assert.equal(pending.approved, undefined);
});
