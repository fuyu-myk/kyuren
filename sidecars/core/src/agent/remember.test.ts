import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { rememberTool } from "#agent/remember.ts";
import type { Embedder } from "#memory/embed.ts";
import { Memory } from "#memory/memory.ts";

const wordsOnly: Embedder = {
  notes: async (texts) => texts.map(() => new Float32Array([1])),
  question: async () => undefined,
};

async function vault(notes: Record<string, string>): Promise<Memory> {
  const dir = await mkdtemp(join(tmpdir(), "kyuren-remember-"));
  for (const [name, text] of Object.entries(notes)) await writeFile(join(dir, name), text);
  const memory = new Memory(() => [dir], ":memory:", wordsOnly);
  await memory.learnEverything();
  return memory;
}

type Answer = { about: string[]; found: Array<{ from: string }> };

test("a question about someone brings more than a handful, and says who was recognised", async () => {
  const notes: Record<string, string> = {};
  for (let at = 0; at < 8; at += 1) {
    notes[`day-${at}.md`] = `# Day ${at}\n\nSpoke with Petra Holst about the outline, again.\n`;
  }
  notes["link.md"] = "# Supervision\n\n[[P. Holst]] asked for the simulation plan first.\n";
  const memory = await vault(notes);

  const answer = (await rememberTool(memory).run({ question: "What does Petra want?" }, new AbortController().signal)) as Answer;
  assert.deepEqual(answer.about, ["Petra Holst"]);
  assert.equal(answer.found.length, 9, "everything written about her, not the first five");
  memory.close();
});

test("a question about nothing in particular keeps to a handful", async () => {
  const notes: Record<string, string> = {};
  for (let at = 0; at < 8; at += 1) {
    notes[`lab-${at}.md`] = `# Lab ${at}\n\nCalorimetry write-up number ${at} is due soon.\n`;
  }
  const memory = await vault(notes);

  const answer = (await rememberTool(memory).run({ question: "when is the calorimetry write-up due" }, new AbortController().signal)) as Answer;
  assert.deepEqual(answer.about, []);
  assert.equal(answer.found.length, 5);
  memory.close();
});

test("what recall hands back is the user's notes, so a turn that recalls holds them", () => {
  assert.equal(rememberTool({} as Parameters<typeof rememberTool>[0]).notes, true);
});
