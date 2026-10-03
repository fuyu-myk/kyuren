import assert from "node:assert/strict";
import { test } from "node:test";
import { blocks, inline } from "./prose.ts";

test("plain words are plain words", () => {
  assert.deepEqual(inline("nothing to mark up"), [{ kind: "text", text: "nothing to mark up" }]);
});

test("the marks that matter are read", () => {
  assert.deepEqual(inline("a **bold** and `code` and *soft*"), [
    { kind: "text", text: "a " },
    { kind: "strong", text: "bold" },
    { kind: "text", text: " and " },
    { kind: "code", text: "code" },
    { kind: "text", text: " and " },
    { kind: "emphasis", text: "soft" },
  ]);
});

test("a link keeps both halves", () => {
  assert.deepEqual(inline("see [the notes](https://example.com/a)"), [
    { kind: "text", text: "see " },
    { kind: "link", text: "the notes", href: "https://example.com/a" },
  ]);
});

test("what is inside backticks is left exactly as it is", () => {
  assert.deepEqual(inline("run `a ** b` now"), [
    { kind: "text", text: "run " },
    { kind: "code", text: "a ** b" },
    { kind: "text", text: " now" },
  ]);
});

test("a lone asterisk is a lone asterisk", () => {
  assert.deepEqual(inline("2 * 3 = 6"), [{ kind: "text", text: "2 * 3 = 6" }]);
});

test("paragraphs are split on blank lines and keep their own line breaks", () => {
  assert.deepEqual(blocks("one\ntwo\n\nthree"), [
    { kind: "paragraph", pieces: [{ kind: "text", text: "one\ntwo" }] },
    { kind: "paragraph", pieces: [{ kind: "text", text: "three" }] },
  ]);
});

test("headings carry their level", () => {
  const found = blocks("# big\n\n### small");
  assert.deepEqual(found.map((one) => one.kind === "heading" && one.level), [1, 3]);
});

test("a run of bullets is one list", () => {
  const found = blocks("before\n\n- one\n- two\n- three\n\nafter");
  assert.equal(found.length, 3);
  const list = found[1]!;
  assert.ok(list.kind === "list" && !list.ordered && list.items.length === 3);
});

test("numbered lists are told apart from bullets", () => {
  const list = blocks("1. one\n2. two")[0]!;
  assert.ok(list.kind === "list" && list.ordered && list.items.length === 2);
});

test("a fenced block is kept verbatim, language and all", () => {
  const found = blocks("look:\n\n```ts\nconst a = 1;\n\n# not a heading\n```\n\ndone");
  const code = found[1]!;
  assert.ok(code.kind === "code");
  assert.equal(code.language, "ts");
  assert.equal(code.text, "const a = 1;\n\n# not a heading");
  assert.equal(found.length, 3);
});

test("a fence nobody closed does not swallow everything after it", () => {
  const found = blocks("```\nstill code");
  assert.equal(found.length, 1);
  assert.ok(found[0]!.kind === "code" && found[0]!.text === "still code");
});

test("quoted lines are gathered into one quote", () => {
  const found = blocks("> first\n> second\n\nafter");
  assert.equal(found.length, 2);
  assert.ok(found[0]!.kind === "quote");
});

test("nothing at all is no blocks at all", () => {
  assert.deepEqual(blocks(""), []);
  assert.deepEqual(blocks("\n\n  \n"), []);
});
