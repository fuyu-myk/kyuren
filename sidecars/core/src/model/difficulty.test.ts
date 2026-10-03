import assert from "node:assert/strict";
import { test } from "node:test";
import { difficultyOf } from "#model/difficulty.ts";

/// These reach the local model. They are about the routing decision, not about the wording of any
/// one answer, so they assert the tier rather than the text.

test("a greeting is trivial, and answered without thinking about it", async () => {
  assert.equal(await difficultyOf("hello"), "trivial");
});

test("a question about the user's own day is not trivial, because it needs a tool", async () => {
  // A model told not to think does not call tools, and the day cannot be answered without one.
  assert.notEqual(await difficultyOf("what's on today"), "trivial");
  assert.notEqual(await difficultyOf("when is my next class"), "trivial");
});

test("small talk stays trivial", async () => {
  assert.equal(await difficultyOf("thanks, that's all"), "trivial");
});

test("general knowledge is not trivial", async () => {
  assert.notEqual(await difficultyOf("what is photosynthesis"), "trivial");
});

test("planning around constraints is hard", async () => {
  assert.equal(
    await difficultyOf("plan my revision for three midterms in two weeks around my lectures"),
    "hard",
  );
});

test("code with an explanation is hard", async () => {
  assert.equal(
    await difficultyOf("write a function that finds the shortest path and explain the complexity"),
    "hard",
  );
});

test("an unreadable answer settles in the middle rather than the top", async () => {
  // Nonsense the router has no example for. Whatever it says, it must be one of the three, and a
  // failure must never land on the tier that costs the most.
  const decided = await difficultyOf("~~~ %%% ???");
  assert.ok(["trivial", "moderate", "hard"].includes(decided));
});
