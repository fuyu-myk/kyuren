import assert from "node:assert/strict";
import { test } from "node:test";
import { difficultyOf, readSpoken, spokenDifficultyOf } from "#model/difficulty.ts";

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

test("typed, general knowledge is known, to be answered without reasoning first", async () => {
  assert.equal(await difficultyOf("What is the greenhouse effect?"), "known");
  assert.equal(await difficultyOf("Why do we have leap years?"), "known");
});

test("typed, a question needing a look is neither known nor trivial, so a tool is reached for", async () => {
  for (const asked of ["Is the gym open on Sunday?", "Which emails need a reply?", "Save this article to the reading list."]) {
    const decided = await difficultyOf(asked);
    assert.ok(decided !== "known" && decided !== "trivial", `${asked} was ${decided}`);
  }
});

test("asked aloud as the transcript writes it, with capitals and a question mark, general knowledge is still known", async () => {
  assert.equal(await spokenDifficultyOf("What is photosynthesis?"), "known");
});

test("an unreadable answer settles in the middle rather than the top", async () => {
  // Nonsense the router has no example for. Whatever it says, it must be one of the three, and a
  // failure must never land on the tier that costs the most.
  const decided = await difficultyOf("~~~ %%% ???");
  assert.ok(["trivial", "known", "moderate", "hard"].includes(decided));
});

test("asked aloud, general knowledge is known, to be answered without reasoning first", async () => {
  assert.equal(await spokenDifficultyOf("what is photosynthesis"), "known");
});

test("asked aloud, a question about the user's own day still needs a look, and so a tool", async () => {
  assert.equal(await spokenDifficultyOf("what's on today"), "moderate");
});

test("asked aloud, a greeting is still trivial", async () => {
  assert.equal(await spokenDifficultyOf("hello"), "trivial");
});

test("asked aloud, nothing about the user's life or about now is taken as known", async () => {
  for (const asked of ["what did the professor say about the essay", "who won the game last night", "has the parcel arrived"]) {
    assert.notEqual(await spokenDifficultyOf(asked), "known", asked);
  }
});

test("the spoken judge's words are read as tiers, and an unreadable one as needing a look", () => {
  const asked = "what is photosynthesis";
  assert.equal(readSpoken("known", asked), "known");
  assert.equal(readSpoken(" Look.", asked), "moderate");
  assert.equal(readSpoken("trivial", asked), "trivial");
  assert.equal(readSpoken("hard", asked), "hard");
  assert.equal(readSpoken("perhaps", asked), "moderate");
});

test("a request about the user's own things or about now is never known, whatever the judge said", () => {
  assert.equal(readSpoken("known", "what is my sister's name"), "moderate");
  assert.equal(readSpoken("known", "what is the news today"), "moderate");
  assert.equal(readSpoken("known", "is it raining tonight"), "moderate");
  assert.equal(readSpoken("known", "how do I boil an egg"), "known");
});
