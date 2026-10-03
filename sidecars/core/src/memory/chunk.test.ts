import assert from "node:assert/strict";
import { test } from "node:test";
import { chunk, hashOf } from "#memory/chunk.ts";

const note = `# Tuesday 15 September

## Today

BIO215 at half past nine.

CHM118 discussion at eleven.

CHM118 at two.

## Notes

Ask the registrar about the extension.

Reading for immunology is chapter four.
`;

test("a chunk carries the heading it belongs to", () => {
  const chunks = chunk(note);
  assert.ok(chunks.length >= 2);
  assert.ok(chunks[0]?.text.startsWith("Today"), "a fragment must say what it belongs to");
  assert.equal(chunks[0]?.heading, "Today");
});

test("a new heading starts a new chunk", () => {
  const headings = chunk(note).map((one) => one.heading);
  assert.deepEqual([...new Set(headings)], ["Today", "Notes"]);
});

test("editing one line changes one chunk and no others", () => {
  const before = chunk(note);
  const after = chunk(note.replace("CHM118 at two.", "CHM118 at two, in the lab."));

  assert.equal(before.length, after.length, "an edit must not move the boundaries");

  const changed = before.filter((one, index) => one.hash !== after[index]?.hash);
  assert.equal(changed.length, 1, `${changed.length} chunks would be embedded again, not 1`);
});

test("adding a paragraph disturbs at most the chunk it joins", () => {
  const before = chunk(note);
  const after = chunk(`${note}\nAnd one more thought.\n`);

  // The addition lands in the last section, so that chunk grows and is embedded again. Nothing
  // written before it may be, which is what keeps a large note cheap to edit.
  const changed = before.filter((one, index) => one.hash !== after[index]?.hash);
  assert.ok(changed.length <= 1, `${changed.length} earlier chunks would be embedded again`);
  assert.deepEqual(
    before.slice(0, -1).map((one) => one.hash),
    after.slice(0, before.length - 1).map((one) => one.hash),
  );
});

test("a long section splits, and an edit late in it leaves the early part alone", () => {
  const long = `## Reading\n\n${Array.from({ length: 9 }, (_, i) => `Paragraph ${i}.`).join("\n\n")}\n`;
  const before = chunk(long);
  assert.ok(before.length >= 3, "a long section must not be one chunk");

  const after = chunk(long.replace("Paragraph 8.", "Paragraph 8, revised."));
  const changed = before.filter((one, index) => one.hash !== after[index]?.hash);
  assert.equal(changed.length, 1);
});

test("the same content anywhere has the same hash", () => {
  assert.equal(hashOf("one two three"), hashOf("one two three"));
  assert.notEqual(hashOf("one two three"), hashOf("one two four"));
});

test("an empty note has no chunks", () => {
  assert.deepEqual(chunk(""), []);
  assert.deepEqual(chunk("\n\n   \n"), []);
});

test("a note with no headings still chunks", () => {
  const chunks = chunk("Just a thought.\n\nAnd another.\n");
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]?.heading, "");
  assert.match(chunks[0]?.text ?? "", /Just a thought/);
});
