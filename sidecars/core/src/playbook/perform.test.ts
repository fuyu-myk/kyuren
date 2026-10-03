import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Transcript } from "#agent/loop.ts";
import { Gate } from "#permission/gate.ts";
import { performPlaybook, wordsFor } from "#playbook/perform.ts";
import { RunLog } from "#playbook/runlog.ts";
import { Playbooks } from "#playbook/store.ts";
import { Sessions } from "#session/store.ts";

const BOOK = `---
name: tidy-notes
when: the user asks for the notes to be tidied
inputs:
  - week: which week
skills: [write_file]
version: 1
author: claude-opus-5 on 2026-09-18
---

## Steps

1. Write the week's summary to ~/summary-{{week}}.md.

## Proof

1. file exists: ~/summary-{{week}}.md
`;

const transcript: Transcript = {
  text: "I wrote the summary.", difficulty: "hard", route: "cloud", model: "claude-opus-5", reason: "test",
  steps: 1, called: [], elapsedMs: 5, usage: { input: 900, output: 40 },
};

test("a playbook run as a conversation keeps the asking and the answer in a pane, with what answered", async () => {
  const home = await mkdtemp(join(tmpdir(), "kyuren-perform-"));
  const books = new Playbooks(join(home, "playbooks"));
  books.propose(BOOK);
  books.approve("tidy-notes", "fuyu");
  const sessions = new Sessions(":memory:");

  const done = await performPlaybook(
    {
      books, runs: new RunLog(join(home, "runs")), sessions, gate: new Gate(() => [], () => {}), ask: async () => "deny",
      vault: home, home,
      perform: async () => {
        await writeFile(join(home, "summary-38.md"), "# Week 38\n");
        return transcript;
      },
    },
    { name: "tidy-notes", inputs: { week: "38" }, saying: "/tidy-notes 38", pane: "knowledge" },
  );

  assert.equal(done.outcome, "done");
  assert.ok(done.answer.startsWith("# Week 38"), "the file produced is shown, not pointed at");
  const [held] = sessions.inPane("knowledge");
  assert.equal(held!.title, "/tidy-notes 38");
  assert.equal(done.session, held!.id);
  const turns = sessions.read(held!.id);
  assert.equal(turns[0]!.text, "/tidy-notes 38");
  assert.deepEqual(turns[1]!.by, { model: "claude-opus-5", route: "cloud", usage: { input: 900, output: 40 } });
});

test("how a run came out is said in a few words", () => {
  assert.equal(wordsFor("done", []), "proof passed");
  assert.equal(wordsFor("failed", [{ item: "file exists: x", passed: false, why: "x does not exist" }]), "proof failed: x does not exist");
  assert.equal(wordsFor("unjudged", []), "not everything could be judged");
});

test("a run is a step of its own, begun with the playbook's name and ended by its proof", async () => {
  const home = await mkdtemp(join(tmpdir(), "kyuren-perform-"));
  const books = new Playbooks(join(home, "playbooks"));
  books.propose(BOOK);
  books.approve("tidy-notes", "fuyu");
  const told: string[] = [];
  const watching = {
    began: (tool: string, target: string) => {
      told.push(`began ${tool} ${target}`);
      return "whole";
    },
    ended: (step: string, ok: boolean) => void told.push(`ended ${step} ${ok}`),
  };
  const on = {
    books, runs: new RunLog(join(home, "runs")), sessions: new Sessions(":memory:"), gate: new Gate(() => [], () => {}),
    ask: async () => "deny" as const, vault: home, home, watching,
  };

  await performPlaybook(
    { ...on, perform: async () => { await writeFile(join(home, "summary-38.md"), "# Week 38\n"); return transcript; } },
    { name: "tidy-notes", inputs: { week: "38" }, saying: "/tidy-notes 38", pane: "knowledge" },
  );
  assert.deepEqual(told, ["began playbook tidy-notes", "ended whole true"]);

  told.length = 0;
  await performPlaybook(
    { ...on, perform: async () => transcript },
    { name: "tidy-notes", inputs: { week: "39" }, saying: "/tidy-notes 39", pane: "knowledge" },
  );
  assert.deepEqual(told, ["began playbook tidy-notes", "ended whole false"], "a proof that fails ends the step as failed");
});
