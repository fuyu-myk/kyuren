import assert from "node:assert/strict";
import { test } from "node:test";
import { chunksAbout, mentioned } from "#entity/mention.ts";
import type { Entity } from "#entity/resolve.ts";

function entity(name: string, aliases: string[], parts: string[], chunks: string[]): Entity {
  return { name, aliases, parts, files: [], chunks, mentions: chunks.length, proven: true };
}

const petra = entity("Petra Holst", ["P. Holst", "Petra Holst"], ["holst", "petra"], ["h1", "h2"]);
const kalman = entity("Kalman", ["Kalman"], ["kalman"], ["h2", "h3"]);
const ana = entity("Ana Lindqvist", ["Ana", "Ana Lindqvist"], ["ana", "lindqvist"], ["h4"]);
const market = entity("Night Market", ["Market", "Night Market"], ["market"], ["h5"]);

test("a question names an entity by any way it is written, as whole words", () => {
  assert.deepEqual(mentioned("Where is P. Holst's office?", [petra, ana]), [petra]);
  assert.deepEqual(mentioned("Is Ana coming?", [petra, ana]), [ana]);
  assert.deepEqual(mentioned("Are the bananas ripe?", [petra, ana]), [], "Ana inside bananas is not Ana");
});

test("a first name or a surname alone names the person", () => {
  assert.deepEqual(mentioned("What does Petra want?", [petra, ana]), [petra]);
  assert.deepEqual(mentioned("Did Holst reply?", [petra, ana]), [petra]);
});

test("a word of a name that the notes also use as a word does not name it", () => {
  assert.deepEqual(mentioned("What happened last night?", [market, ana]), [], "night is not a part of Night Market");
  assert.deepEqual(mentioned("Was the market busy?", [market, ana]), [market]);
});

test("something written only one way is not expanded, since its own word already finds it", () => {
  assert.deepEqual(mentioned("Revise the Kalman question", [petra, kalman]), []);
});

test("chunks that mention more of the named entities come first", () => {
  const ranked = chunksAbout([petra, kalman]);
  assert.equal(ranked[0]?.id, "h2", "h2 mentions both");
  assert.deepEqual(ranked.map((one) => one.id), ["h2", "h1", "h3"]);
});
