import assert from "node:assert/strict";
import { test } from "node:test";
import { group, merge, onlyProven, type Seen } from "#entity/resolve.ts";

function seen(name: string, file: string, proven = true, hash = file, whole = true): Seen {
  return { name, file, hash, proven, whole };
}

/// The tail of a run that opened a sentence: proven by its position, never written by itself.
function tail(name: string, file: string): Seen {
  return { name, file, hash: file, proven: true, whole: false };
}

test("the same name written the same way is one entity", () => {
  const entities = merge(group([seen("Petra", "a.md"), seen("Petra", "b.md")]));
  assert.equal(entities.length, 1);
  assert.equal(entities[0]?.mentions, 2);
  assert.deepEqual(entities[0]?.files, ["a.md", "b.md"]);
});

test("a title is not a different person", () => {
  const entities = merge(group([seen("Professor Delgado", "a.md"), seen("Delgado", "b.md")]));
  assert.equal(entities.length, 1);
  assert.equal(entities[0]?.mentions, 2);
});

test("a possessive and an accent are not different people", () => {
  const entities = merge(group([
    seen("Delgado", "a.md"),
    seen("Delgado's", "b.md"),
    seen("Delg\u00e1do", "c.md"),
  ]));
  assert.equal(entities.length, 1);
  assert.equal(entities[0]?.mentions, 3);
});

test("a shortened name joins its full form", () => {
  const entities = merge(group([seen("Petra", "a.md"), seen("Petra Holst", "b.md")]));
  assert.equal(entities.length, 1);
  assert.equal(entities[0]?.name, "Petra Holst", "the fuller form is what a person recognises");
  assert.deepEqual(entities[0]?.aliases, ["Petra", "Petra Holst"]);
});

test("a surname alone joins the full name too", () => {
  const entities = merge(group([seen("Holst", "a.md"), seen("Petra Holst", "b.md")]));
  assert.equal(entities.length, 1);
  assert.equal(entities[0]?.name, "Petra Holst");
});

test("initials join the name they stand for", () => {
  const entities = merge(group([seen("P. Holst", "a.md"), seen("Petra Holst", "b.md")]));
  assert.equal(entities.length, 1);
  assert.deepEqual(entities[0]?.aliases, ["P. Holst", "Petra Holst"]);
});

test("a short form held by two names joins neither", () => {
  const entities = merge(group([
    seen("Sam", "a.md"),
    seen("Sam Lee", "b.md"),
    seen("Sam Altman", "c.md"),
  ]));
  assert.equal(entities.length, 3, "Sam between two Sams says nothing about which");
  assert.ok(entities.every((one) => one.mentions === 1));
});

test("two people who share a surname stay two people", () => {
  const entities = merge(group([
    seen("Ana Lindqvist", "a.md"),
    seen("Aaron Lindqvist", "b.md"),
    seen("Lindqvist", "c.md"),
  ]));
  const names = entities.map((one) => one.name).sort();
  assert.deepEqual(names, ["Aaron Lindqvist", "Ana Lindqvist", "Lindqvist"]);
});

test("two different things stay apart, even when they look similar", () => {
  const entities = merge(group([seen("MAT210", "a.md"), seen("BIO215", "a.md")]));
  assert.equal(entities.length, 2, "two course codes are two courses");
});

test("a word that is not part of a name does not join it", () => {
  const entities = merge(group([seen("Petra Holst", "a.md"), seen("Exam", "b.md", false)]));
  assert.equal(entities.length, 2);
});

test("the same person across nine notes is one entity with nine mentions", () => {
  const notes = Array.from({ length: 9 }, (_, at) => `note-${at}.md`);
  const mentions = notes.map((file, at) =>
    seen(at % 3 === 0 ? "Petra Holst" : at % 3 === 1 ? "Petra" : "Professor Holst", file));

  const entities = merge(group(mentions));
  assert.equal(entities.length, 1, `resolved to ${entities.length} people, not one`);
  assert.equal(entities[0]?.mentions, 9);
  assert.equal(entities[0]?.files.length, 9);
});

test("an entity knows every chunk that mentions it", () => {
  const entities = merge(group([
    seen("Petra Holst", "a.md", true, "h1"),
    seen("Petra", "a.md", true, "h2"),
    seen("Holst", "b.md", true, "h3"),
  ]));
  assert.deepEqual(entities[0]?.chunks, ["h1", "h2", "h3"]);
});

test("a name never written outside a sentence start is not a name", () => {
  const kept = onlyProven(merge(group([seen("Ask", "a.md", false), seen("Petra", "a.md", true)])));
  assert.deepEqual(kept.map((one) => one.name), ["Petra"]);
});

test("a form that only ever opens a sentence still counts once it joins a proven name", () => {
  // "Holst" opens its sentence every time it is written, so it is never proven alone. It plainly
  // belongs to the Petra Holst of every other note.
  const kept = onlyProven(merge(group([
    seen("Petra Holst", "a.md", true),
    seen("Holst", "b.md", false),
  ])));

  assert.equal(kept.length, 1);
  assert.equal(kept[0]?.mentions, 2);
  assert.deepEqual(kept[0]?.files, ["a.md", "b.md"]);
  assert.equal(kept[0]?.name, "Petra Holst", "the name is the form actually proven");
});

test("a run with an extra word stuck on the front is not a way the name is written", () => {
  const entities = merge(group([
    seen("Petra Holst", "a.md"),
    seen("Met Petra Holst", "b.md", false),
  ]));

  assert.equal(entities.length, 1);
  assert.equal(entities[0]?.mentions, 2, "the mention still counts");
  assert.deepEqual(entities[0]?.aliases, ["Petra Holst"], "but it is not listed as a name");
});

test("the tail of a whole name is not listed as a way it is written", () => {
  const entities = merge(group([
    seen("Ana Lindqvist", "a.md", false),
    tail("Lindqvist", "a.md"),
    seen("Ana", "b.md"),
  ]));
  assert.equal(entities.length, 1);
  assert.deepEqual(entities[0]?.aliases, ["Ana", "Ana Lindqvist"]);
  assert.equal(entities[0]?.name, "Ana Lindqvist");
});

test("the tail of an overgrown run is the name itself", () => {
  const entities = merge(group([
    seen("Met Petra Holst", "a.md", false),
    tail("Petra Holst", "a.md"),
  ]));
  assert.equal(entities.length, 1);
  assert.deepEqual(entities[0]?.aliases, ["Petra Holst"]);
  assert.equal(entities[0]?.name, "Petra Holst");
});
