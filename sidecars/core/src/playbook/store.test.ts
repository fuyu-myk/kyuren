import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Playbooks } from "#playbook/store.ts";

const BOOK = `---
name: weekly-review
when: the user asks for a weekly review
skills: [remember]
version: 1
author: claude-opus-5 on 2026-09-18
---

## Steps

1. Recall the week.

## Proof

1. file exists: ~/.kyuren/vault/reviews/{{week}}.md
`;

async function fresh(): Promise<Playbooks> {
  return new Playbooks(await mkdtemp(join(tmpdir(), "kyuren-playbooks-")));
}

test("a proposed playbook is pending, and pending is not something a runner can read", async () => {
  const store = await fresh();
  const proposed = store.propose(BOOK);
  assert.equal(proposed.name, "weekly-review");
  assert.equal(store.read("weekly-review"), undefined, "unapproved, so unreadable by any path");
  assert.deepEqual(store.list(), [{ name: "weekly-review", approved: false, pending: true }]);
});

test("approval moves it into place and writes who approved it and when", async () => {
  const store = await fresh();
  store.propose(BOOK);
  const approved = store.approve("weekly-review", "fuyu");
  assert.ok(approved.approved?.startsWith("fuyu on 20"));
  assert.equal(store.read("weekly-review")?.name, "weekly-review");
  assert.deepEqual(store.list(), [{ name: "weekly-review", approved: true, pending: false }]);
});

test("a repair is pending beside the approved one, with a diff, until it is approved in turn", async () => {
  const store = await fresh();
  store.propose(BOOK);
  store.approve("weekly-review", "fuyu");
  store.propose(BOOK.replace("1. Recall the week.", "1. Recall the week, from every vault."));
  assert.deepEqual(store.list(), [{ name: "weekly-review", approved: true, pending: true }]);
  assert.equal(store.read("weekly-review")?.steps[0], "Recall the week.", "the runner still sees the approved text");
  const diff = store.diff("weekly-review");
  assert.ok(diff.includes("-1. Recall the week."));
  assert.ok(diff.includes("+1. Recall the week, from every vault."));
  store.reject("weekly-review");
  assert.deepEqual(store.list(), [{ name: "weekly-review", approved: true, pending: false }]);
});

test("a proof the model could talk itself past is refused at the door", async () => {
  const store = await fresh();
  const talk = BOOK.replace("1. file exists: ~/.kyuren/vault/reviews/{{week}}.md", "1. judged: it looks fine");
  assert.throws(() => store.propose(talk), /talk itself past/);
});

test("a playbook that does not parse is refused with the reason", async () => {
  const store = await fresh();
  assert.throws(() => store.propose(BOOK.replace("## Proof", "## Notes")), /proof/);
});

test("a name that could climb out of the playbooks folder is no playbook's, whoever wrote it", async () => {
  const root = await mkdtemp(join(tmpdir(), "kyuren-playbooks-"));
  const store = new Playbooks(root);
  assert.throws(() => store.propose(BOOK.replace("name: weekly-review", "name: ../vault/today")), /not a playbook's name/);
  for (const name of ["../vault/today", "/etc/hosts", "weekly review", "Weekly-Review"]) {
    assert.throws(() => store.reject(name), /not a playbook's name/, name);
    assert.throws(() => store.read(name), /not a playbook's name/, name);
  }
  writeFileSync(join(root, "Put By Hand.md"), BOOK);
  assert.deepEqual(store.list(), [], "a file whose name is no playbook's is not listed as one");
});
