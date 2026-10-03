import assert from "node:assert/strict";
import { test } from "node:test";
import { levelFor } from "./level.ts";

test("speaking follows the energy it is given", () => {
  const quiet = levelFor("speaking", 0.05, 0);
  const loud = levelFor("speaking", 0.9, 0);
  assert.ok(loud > quiet, "a loud moment of the reply must read higher than a quiet one");
  assert.equal(loud, 0.9);
});

test("listening and speaking read the same energy the same way", () => {
  for (const energy of [0, 0.2, 0.55, 1]) {
    assert.equal(levelFor("listening", energy, 1.4), levelFor("speaking", energy, 1.4));
  }
});

test("silence still breathes rather than going flat", () => {
  for (const state of ["listening", "speaking", "idle"] as const) {
    assert.ok(levelFor(state, 0, 2.3) > 0.05, `${state} went flat`);
  }
});

test("thinking animates without any energy", () => {
  const early = levelFor("thinking", 0, 0);
  const later = levelFor("thinking", 0, 0.4);
  assert.notEqual(early, later);
  assert.equal(levelFor("thinking", 1, 0), early, "thinking ignores the energy channel");
});
