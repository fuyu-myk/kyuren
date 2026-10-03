import assert from "node:assert/strict";
import { test } from "node:test";
import { candidates, key, tidy } from "#entity/names.ts";

function named(text: string): string[] {
  return candidates(text).map((one) => one.name).sort();
}

test("a titled name is a name wherever it appears", () => {
  assert.ok(named("Professor Delgado teaches immunology.").includes("Delgado"));
  assert.ok(named("I saw Dr. Chen today.").includes("Chen"));
});

test("a linked name is a name", () => {
  assert.ok(named("Spoke to [[Petra Holst]] about the practical.").includes("Petra Holst"));
  assert.ok(named("See [[Petra|her note]].").includes("Petra"));
});

test("a course code is a name", () => {
  const found = named("MAT210 and BIO215 clash on Tuesday.");
  assert.ok(found.includes("MAT210"));
  assert.ok(found.includes("BIO215"));
});

test("a word starting a sentence is not proven by that alone", () => {
  const [petra] = candidates("Petra is my lab partner.").filter((one) => one.name === "Petra");
  assert.equal(petra?.proven, false, "a capital at the start of a sentence proves nothing");

  const [again] = candidates("My partner is Petra, who runs late.").filter((one) => one.name === "Petra");
  assert.equal(again?.proven, true, "capitalised mid sentence, so it is a name");
});

test("ordinary sentence openers are not names", () => {
  const found = named("The registrar replied. Ask again tomorrow. Tuesday is busy.");
  for (const word of ["The", "Ask", "Tuesday"]) {
    assert.ok(!found.includes(word), `${word} was taken for a name`);
  }
});

test("a title is not part of the name it introduces", () => {
  assert.equal(key("Professor Delgado"), "delgado");
  assert.equal(key("Dr. Delgado"), "delgado");
  assert.equal(key("delgado"), "delgado");
});

test("spacing and trailing punctuation do not make a different name", () => {
  assert.equal(tidy("  Petra   Holst ,"), "Petra Holst");
  assert.equal(key("Petra Holst"), key("petra  holst"));
});

test("nothing is found in text with no names", () => {
  assert.deepEqual(named("ask the registrar about an extension."), []);
});

test("a possessive is the same name", () => {
  assert.equal(key("Delgado's"), "delgado");
  assert.equal(key("Petra Holst\u2019s"), "petra holst");
});

test("an accent is the same name", () => {
  assert.equal(key("Petra H\u00f6lst"), "petra holst");
});

test("a day or a month is not a name, nor the end of one", () => {
  assert.ok(!named("Office hours are Tuesdays from two.").includes("Tuesdays"));
  assert.ok(!named("The deadline is in December.").includes("December"));

  const found = named("See Dr Delgado Tuesdays at two.");
  assert.ok(found.includes("Delgado"), `Delgado is missing from ${JSON.stringify(found)}`);
  assert.ok(!found.some((name) => /Tuesdays/.test(name)), `a day rode along in ${JSON.stringify(found)}`);
});

test("the rest of a sentence-opening run is proven, but was not written on its own", () => {
  const found = candidates("Ana Lindqvist is my lab partner.");
  const tail = found.find((one) => one.name === "Lindqvist");
  assert.equal(tail?.proven, true);
  assert.equal(tail?.whole, false, "Lindqvist was never written by itself");
  const run = found.find((one) => one.name === "Ana Lindqvist");
  assert.equal(run?.whole, true);
});

test("markdown in front of a word does not make it mid sentence", () => {
  const text = [
    "- In the paper they argue otherwise.",
    "* For example, the bracket.",
    "1. Some of it held.",
    "> No, said the reviewer.",
    "**Because** it was late.",
    "(Then again, maybe.)",
    "| Cell | Value |",
    "## Concepts",
  ].join("\n");
  const found = candidates(text).filter((one) => one.proven).map((one) => one.name);
  assert.deepEqual(found, [], `${JSON.stringify(found)} were taken for names`);
});

test("a run that is a whole line is a title, and gets no tail", () => {
  const found = candidates("Raw Sources\n\nThe lecture covered diffusion.");
  assert.ok(!found.some((one) => one.name === "Sources"), "the tail of a heading is not a name");
  const heading = found.find((one) => one.name === "Raw Sources");
  assert.equal(heading?.proven, false, "a title line proves nothing by itself");

  const prose = candidates("Ana Lindqvist is my lab partner.");
  assert.ok(prose.some((one) => one.name === "Lindqvist" && one.proven), "a sentence still has a tail");
});

test("a word that only ever begins clauses is not a name however it is capitalised", () => {
  const found = candidates("We met In the hall, and Because of that, With luck, we left.");
  const names = found.filter((one) => one.proven).map((one) => one.name);
  assert.deepEqual(names, [], `${JSON.stringify(names)} were taken for names`);
});
