import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Run as Turn, Transcript } from "#agent/loop.ts";
import { authoringOffered, playbookTool, playbooksTool } from "#agent/playbook.ts";
import { Gate } from "#permission/gate.ts";
import { RunLog } from "#playbook/runlog.ts";
import { Playbooks } from "#playbook/store.ts";

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

function transcript(text: string): Transcript {
  return { text, difficulty: "hard", route: "cloud", model: "claude-opus-5", reason: "test", steps: 1, called: [], elapsedMs: 5 };
}

test("only the frontier model is given the tool that writes playbooks", () => {
  assert.equal(authoringOffered("cloud"), true);
  assert.equal(authoringOffered("local-small"), false);
  assert.equal(authoringOffered("local-large"), false);
});

test("several playbooks run a handful at a time, each with its own log, and each is told of", async () => {
  const home = await mkdtemp(join(tmpdir(), "kyuren-playbooks-"));
  const books = new Playbooks(join(home, "playbooks"));
  books.propose(BOOK);
  books.approve("tidy-notes", "fuyu");

  let running = 0;
  let most = 0;
  const told: string[] = [];
  const tool = playbooksTool({
    books, runs: new RunLog(join(home, "runs")), vault: home, home,
    gate: new Gate(() => [], () => {}), ask: async () => "allow",
    perform: async (turn: Turn) => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((ready) => setTimeout(ready, 25));
      const week = /- week: (\S+)/.exec(turn.system ?? "")?.[1];
      if (week !== "missing") await writeFile(join(home, `summary-${week}.md`), `# Week ${week}\n`);
      running -= 1;
      return transcript(`wrote week ${week}`);
    },
    onRan: (ran) => told.push(`${ran.run.playbook}:${ran.run.outcome}`),
  });

  const weeks = ["36", "37", "38", "39", "missing"];
  const result = await tool.run(
    { runs: [...weeks.map((week) => ({ name: "tidy-notes", inputs: { week } })), { name: "nobody", inputs: {} }] },
    new AbortController().signal,
  ) as { ran: Array<{ name: string; outcome: string; log?: string; reason?: string }> };

  assert.equal(most, 3, "a handful at a time, and no more");
  assert.deepEqual(result.ran.map((one) => one.outcome), ["done", "done", "done", "done", "failed", "failed"], "in the order asked");
  assert.equal(new Set(result.ran.slice(0, 5).map((one) => one.log)).size, 5, "each run has its own log");
  assert.match(result.ran[5]!.reason ?? "", /no approved playbook named nobody/);
  assert.ok(told.includes("nobody:failed"), "so the parent's proof counts it");
  assert.equal(told.length, 6, "every run is told of, the one that could not start as a run that failed");
});

test("a playbook started from a turn that has read the user's notes is started holding them", async () => {
  const home = await mkdtemp(join(tmpdir(), "kyuren-playbooks-"));
  const books = new Playbooks(join(home, "playbooks"));
  books.propose(BOOK);
  books.approve("tidy-notes", "fuyu");
  let holding: boolean | undefined;
  const tool = playbookTool({
    books, runs: new RunLog(join(home, "runs")), vault: home, home,
    gate: new Gate(() => [], () => {}), ask: async () => "allow",
    exposed: () => true,
    perform: async (turn: Turn) => {
      holding = turn.exposed;
      return transcript("done");
    },
  });
  await tool.run({ name: "tidy-notes", inputs: { week: "38" } }, new AbortController().signal);
  assert.equal(holding, true);
});

test("a playbook started from a turn on the cloud is started as one whose findings go there", async () => {
  const home = await mkdtemp(join(tmpdir(), "kyuren-playbooks-"));
  const books = new Playbooks(join(home, "playbooks"));
  books.propose(BOOK);
  books.approve("tidy-notes", "fuyu");
  let above: boolean | undefined;
  const tool = playbookTool({
    books, runs: new RunLog(join(home, "runs")), vault: home, home,
    gate: new Gate(() => [], () => {}), ask: async () => "allow",
    cloud: () => true,
    perform: async (turn: Turn) => {
      above = turn.cloudAbove;
      return transcript("done");
    },
  });
  await tool.run({ name: "tidy-notes", inputs: { week: "38" } }, new AbortController().signal);
  assert.equal(above, true);
});
