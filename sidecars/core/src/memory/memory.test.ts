import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Embedder } from "#memory/embed.ts";
import { Memory } from "#memory/memory.ts";

/// No meaning at all, so what is found is found by words and by who is named.
const wordsOnly: Embedder = {
  notes: async (texts) => texts.map(() => new Float32Array([1])),
  question: async () => undefined,
};

async function vault(notes: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kyuren-memory-"));
  for (const [name, text] of Object.entries(notes)) await writeFile(join(dir, name), text);
  return dir;
}

test("a question that names someone reaches a note that writes them another way", async () => {
  const dir = await vault({
    "petra.md": "# Petra\n\nMet Petra Holst about the outline. She wants it by Friday.\n",
    "holst.md": "# Supervision\n\n[[P. Holst]] asked for the simulation plan first.\n",
    "thermo.md": "# Thermo\n\nCalorimetry write-up is due in two weeks.\n",
  });
  const memory = new Memory(() => [dir], ":memory:", wordsOnly);
  await memory.learnEverything();

  const found = await memory.recall("What does Petra want?", 2);
  const files = found.map((one) => one.file.split("/").pop()).sort();
  assert.deepEqual(files, ["holst.md", "petra.md"], "the note that says P. Holst is about her too");
  memory.close();
});

test("a question that names nobody is answered by words as before", async () => {
  const dir = await vault({
    "petra.md": "# Petra\n\nMet Petra Holst about the outline.\n",
    "thermo.md": "# Thermo\n\nCalorimetry write-up is due in two weeks.\n",
  });
  const memory = new Memory(() => [dir], ":memory:", wordsOnly);
  await memory.learnEverything();

  const found = await memory.recall("when is the calorimetry write-up due", 1);
  assert.equal(found[0]?.file.split("/").pop(), "thermo.md");
  memory.close();
});

test("a folder taken away leaves none of its text behind in the index", async () => {
  const kept = await vault({ "mine.md": "# Mine\n\nSomething I keep.\n" });
  const gone = await vault({ "theirs.md": "# Theirs\n\nSomething private that was only ever read.\n" });
  let where = [kept, gone];
  const memory = new Memory(() => where, ":memory:", wordsOnly);
  await memory.learnEverything();
  assert.equal(memory.counts().chunks, 2);

  where = [kept];
  const built = await memory.relearn();
  assert.equal(built.chunks, 1, "the text of the folder that left is gone at once");
  assert.equal(memory.counts().chunks, 1);
  memory.close();
});
