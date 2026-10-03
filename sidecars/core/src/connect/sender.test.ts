import assert from "node:assert/strict";
import { test } from "node:test";
import { sender } from "#connect/sender.ts";

test("a named sender reads as the name alone", () => {
  assert.equal(sender("Ana Lindqvist <someone@example.com>"), "Ana Lindqvist");
  assert.equal(sender('"Lindqvist, Ana" <someone@example.com>'), "Lindqvist, Ana");
});

test("a bare address is left as it is", () => {
  assert.equal(sender("someone@example.com"), "someone@example.com");
});

test("a missing sender is absent rather than empty", () => {
  assert.equal(sender(undefined), undefined);
  assert.equal(sender("   "), undefined);
});
