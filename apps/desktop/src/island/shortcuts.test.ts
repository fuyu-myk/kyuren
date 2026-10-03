import assert from "node:assert/strict";
import { test } from "node:test";
import { chosen, promptFor, runnable, type Book } from "./shortcuts.ts";

const book = (name: string, inputs: Array<[string, string]>): Book => ({ name, when: "", approved: true, inputs: inputs.map(([one, about]) => ({ name: one, about })) });

test("a shortcut runs at once, asks one thing first, or is for the chat when it needs more than one answer", () => {
  assert.equal(runnable(book("standup", [])), "now");
  assert.equal(runnable(book("research", [["topic", "what to look into"]])), "asks");
  assert.equal(runnable(book("note", [["text", "what to note"], ["slug", ""], ["date", ""]])), "asks", "the rest found from the words and the day");
  assert.equal(runnable(book("trip", [["city", "where"], ["nights", "how long"]])), "elsewhere");
  assert.equal(promptFor(book("research", [["topic", "what to look into"]])), "topic: what to look into");
  assert.equal(promptFor(book("standup", [])), "");
});

test("the shortcuts shown are the ones chosen, in the order chosen, and only approved books", () => {
  const books = [book("b", []), book("a", []), { ...book("pending", []), approved: false }];
  assert.deepEqual(chosen(["a", "gone", "pending", "b"], books).map((one) => one.name), ["a", "b"]);
});
