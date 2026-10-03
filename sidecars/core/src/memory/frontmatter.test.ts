import assert from "node:assert/strict";
import { test } from "node:test";
import { frontmatter, tagsOf } from "#memory/frontmatter.ts";

test("a note with no frontmatter is left exactly as it is", () => {
  const note = "# A note\n\nSomething.\n";
  const front = frontmatter(note);
  assert.equal(front.body, note);
  assert.deepEqual(front.fields, {});
});

test("frontmatter is taken off the body", () => {
  const front = frontmatter("---\ntitle: Immunology\n---\n# Immunology\n\nAntigen presentation.\n");
  assert.equal(front.body, "# Immunology\n\nAntigen presentation.\n");
  assert.deepEqual(front.fields.title, ["Immunology"]);
});

test("an inline list of tags is a list", () => {
  const front = frontmatter("---\ntags: [biology, revision]\n---\nBody.\n");
  assert.deepEqual(front.fields.tags, ["biology", "revision"]);
});

test("a dashed list of tags is a list", () => {
  const front = frontmatter("---\ntags:\n  - biology\n  - revision\n---\nBody.\n");
  assert.deepEqual(front.fields.tags, ["biology", "revision"]);
});

test("quotes are not part of a value", () => {
  const front = frontmatter("---\ntitle: \"Cell Biology\"\naliases: ['BIO215']\n---\nBody.\n");
  assert.deepEqual(front.fields.title, ["Cell Biology"]);
  assert.deepEqual(front.fields.aliases, ["BIO215"]);
});

test("tags written in the body count too", () => {
  const front = frontmatter("---\ntags: [revision]\n---\nReading #immunology and #cell-biology.\n");
  assert.deepEqual(tagsOf(front, front.body).sort(), ["cell-biology", "immunology", "revision"]);
});

test("a heading is not a tag", () => {
  const front = frontmatter("# Heading\n\nSome words.\n");
  assert.deepEqual(tagsOf(front, front.body), []);
});

test("frontmatter that is not closed is not frontmatter", () => {
  const note = "---\ntitle: unfinished\n\nBody.\n";
  assert.equal(frontmatter(note).body, note);
});
