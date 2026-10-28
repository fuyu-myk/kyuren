import assert from "node:assert/strict";
import { test } from "node:test";
import { ordered, type Todo } from "./todos.ts";

const todo = (id: string, done = false): Todo => ({ id, text: id, done, at: 1 });

test("what is left to do comes first, in the order it was added, and what is done after it", () => {
  assert.deepEqual(ordered([todo("a", true), todo("b"), todo("c", true), todo("d")]).map((one) => one.id), ["b", "d", "a", "c"]);
});
