import assert from "node:assert/strict";
import { test } from "node:test";
import { chunk } from "#memory/chunk.ts";
import { Index } from "#memory/index.ts";

function fresh(): Index {
  return new Index(":memory:");
}

function vector(...numbers: number[]): Float32Array {
  return new Float32Array(numbers);
}

const note = "## Today\n\nBIO215 at half past nine.\n\n## Notes\n\nAsk the registrar.\n";

function fill(index: Index, file: string, markdown: string): ReturnType<typeof chunk> {
  const chunks = chunk(markdown);
  for (const one of index.unknown(chunks.map((c) => c.hash))) {
    const found = chunks.find((c) => c.hash === one);
    if (found) index.remember(found, vector(1, 0, 0));
  }
  index.place(file, chunks);
  return chunks;
}

test("a chunk is embedded once, however many files hold it", () => {
  const index = fresh();
  fill(index, "a.md", note);
  const again = chunk(note).map((one) => one.hash);

  assert.deepEqual(index.unknown(again), [], "nothing already held is offered for embedding again");
  index.close();
});

test("rewriting a file only offers what its text changed", () => {
  const index = fresh();
  fill(index, "a.md", note);

  const edited = note.replace("Ask the registrar.", "Ask the registrar about the extension.");
  const chunks = chunk(edited);
  assert.equal(index.unknown(chunks.map((one) => one.hash)).length, 1,
    "a one line edit must offer exactly one chunk");
  index.close();
});

test("keyword search finds a chunk by a word in it", () => {
  const index = fresh();
  fill(index, "a.md", note);

  const found = index.byWords("registrar", 10);
  assert.equal(found.length, 1);
  assert.match(index.held(found)[0]?.text ?? "", /registrar/);
  index.close();
});

test("keyword search survives punctuation in the question", () => {
  const index = fresh();
  fill(index, "a.md", note);
  assert.ok(index.byWords("registrar?!", 10).length > 0);
  assert.deepEqual(index.byWords("   ", 10), []);
  index.close();
});

test("a chunk nothing points at any more is pruned", () => {
  const index = fresh();
  fill(index, "a.md", note);
  const before = index.counts().chunks;

  index.forget("a.md");
  assert.equal(index.prune(), before);
  assert.equal(index.counts().chunks, 0);
  assert.deepEqual(index.byWords("registrar", 10), [], "a pruned chunk is not still findable");
  index.close();
});

test("a chunk two files share survives one of them going", () => {
  const index = fresh();
  fill(index, "a.md", note);
  fill(index, "b.md", note);

  index.forget("a.md");
  assert.equal(index.prune(), 0, "the other file still points at these chunks");
  assert.ok(index.byWords("registrar", 10).length > 0);
  index.close();
});

test("vectors come back as they went in", () => {
  const index = fresh();
  const chunks = chunk(note);
  index.remember(chunks[0]!, vector(0.5, -0.25, 0.125));
  index.place("a.md", [chunks[0]!]);

  const held = index.vectors();
  assert.equal(held.length, 1);
  assert.deepEqual([...held[0]!.vector], [0.5, -0.25, 0.125]);
  index.close();
});

test("what is held is countable", () => {
  const index = fresh();
  fill(index, "a.md", note);
  const counts = index.counts();
  assert.equal(counts.files, 1);
  assert.ok(counts.chunks >= 2);
  assert.equal(counts.embedded, counts.chunks);
  index.close();
});
