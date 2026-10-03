import assert from "node:assert/strict";
import { test } from "node:test";
import { connected, forget, remember, secretFor } from "#connect/secrets.ts";

test("a credential can be handed over and read back", () => {
  remember("notion", "ntn_example");
  assert.equal(secretFor("notion"), "ntn_example");
  forget("notion");
});

test("credentials are listed by name, never by value", () => {
  remember("notion", "ntn_example");
  remember("google", "token");
  assert.deepEqual(connected(), ["google", "notion"]);
  assert.ok(!JSON.stringify(connected()).includes("ntn_example"));
  forget("notion");
  forget("google");
});

test("forgetting one credential leaves the others", () => {
  remember("notion", "ntn_example");
  remember("google", "token");
  forget("notion");
  assert.equal(secretFor("notion"), undefined);
  assert.equal(secretFor("google"), "token");
  forget("google");
});

test("an unheld credential reads as absent", () => {
  assert.equal(secretFor("nothing-here"), undefined);
});
