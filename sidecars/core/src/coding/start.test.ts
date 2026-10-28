import assert from "node:assert/strict";
import { test } from "node:test";
import { PROMPT_MOST, promptOf, sessionLink } from "#coding/start.ts";

test("a new session is opened in a folder by the link the Claude app's own Finder service builds", () => {
  assert.equal(sessionLink("/Users/me/Coding/kyuren"), "claude://code/new?folder=%2FUsers%2Fme%2FCoding%2Fkyuren");
});

test("a request travels whole in the link, whatever it holds", () => {
  const folder = "/Users/me/Coding/two words & more";
  const prompt = "Fix #38: the test fails with a=1&b=2\n\tthen push?";
  const link = new URL(sessionLink(folder, prompt));
  assert.equal(link.protocol, "claude:");
  assert.equal(link.host, "code");
  assert.equal(link.pathname, "/new");
  assert.deepEqual([...link.searchParams.keys()], ["folder", "q"]);
  assert.equal(link.searchParams.get("folder"), folder);
  assert.equal(link.searchParams.get("q"), prompt);
});

test("a request is trimmed, and an empty one asks for nothing", () => {
  assert.equal(promptOf("  fix the failing test \n"), "fix the failing test");
  assert.equal(promptOf("   "), "");
  assert.equal(sessionLink("/x", ""), "claude://code/new?folder=%2Fx");
});

test("a request keeps its lines and tabs but nothing that would show differently from what is sent", () => {
  assert.equal(promptOf("one\r\ntwo\n\tthree"), "one\ntwo\n\tthree");
  for (const hiding of ["‮evil", "zero​width", "escape\u001B[2J", "bell\u0007"]) {
    assert.equal(promptOf(hiding), undefined, JSON.stringify(hiding));
  }
});

test("a request longer than a session should be handed is refused rather than cut", () => {
  assert.equal(promptOf("a".repeat(PROMPT_MOST))?.length, PROMPT_MOST);
  assert.equal(promptOf("a".repeat(PROMPT_MOST + 1)), undefined);
});
