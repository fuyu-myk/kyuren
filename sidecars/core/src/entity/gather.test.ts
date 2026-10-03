import assert from "node:assert/strict";
import { test } from "node:test";
import { gatherEntities } from "#entity/gather.ts";
import type { Held } from "#memory/index.ts";

function held(file: string, text: string, hash = file): Held {
  return { hash, text, heading: "", file };
}

test("words that open sentences do not become ways a person is written", () => {
  const entities = gatherEntities([
    held("gig.md", "Afterwards we met Sam, who does their posters. Discussion ran late."),
    held("notes.md", "She wants a one page outline. Exam plan is on the wall. Ask Sam about it."),
  ]);
  const sam = entities.find((one) => one.name === "Sam");
  assert.ok(sam, "Sam is a name");
  assert.deepEqual(sam.aliases, ["Sam"]);
  assert.deepEqual(entities.map((one) => one.name), ["Sam"]);
});

test("a first name and the full name are one person, and a brother is not", () => {
  const entities = gatherEntities([
    held("ana.md", "Ana Lindqvist is my lab partner. Ana is good at the write-ups.", "h1"),
    held("gig.md", "Went to the gig with Ana. Ana's brother Aaron sang most of the set.", "h2"),
  ]);
  const ana = entities.find((one) => one.name === "Ana Lindqvist");
  assert.ok(ana, `Ana is ${JSON.stringify(entities.map((one) => one.name))}`);
  assert.deepEqual(ana.aliases, ["Ana", "Ana Lindqvist"], "Lindqvist alone was never written");
  assert.deepEqual(ana.chunks, ["h1", "h2"]);
  assert.ok(entities.some((one) => one.name === "Aaron"), "Aaron is his own person");
});

test("a word the notes also write in lowercase cannot stand for a name", () => {
  const entities = gatherEntities([
    held("gig.md", "Went to the Night Market with Ana. Late at night we walked back."),
  ]);
  const market = entities.find((one) => one.name === "Night Market");
  assert.ok(market, `Night Market is missing from ${JSON.stringify(entities.map((one) => one.name))}`);
  assert.deepEqual(market.parts, ["market"], "night is an ordinary word in these notes");
});
