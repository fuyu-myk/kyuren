import assert from "node:assert/strict";
import { test } from "node:test";
import { bySender, inWords } from "#brief/senders.ts";
import type { Item } from "#connect/source.ts";

function message(sender: string | undefined, title: string): Item {
  return {
    source: "gmail",
    kind: "message",
    collection: "Inbox",
    title,
    at: "2026-09-15T09:00:00Z",
    timed: true,
    status: sender,
    done: false,
  };
}

test("one sender writing twice is one entry, counted", () => {
  const grouped = bySender([
    message("Microsoft account team", "New app(s) connected to your Microsoft account"),
    message("Microsoft account team", "New app(s) connected to your Microsoft account"),
  ]);

  assert.equal(grouped.length, 1);
  assert.equal(grouped[0]?.count, 2);
  assert.deepEqual(grouped[0]?.subjects, ["New app(s) connected to your Microsoft account"],
    "the same thing said twice is not two things");
});

test("one sender writing about two things keeps both", () => {
  const grouped = bySender([
    message("Coursera", "Ready: Everyday Excel"),
    message("Coursera", "Your certificate is ready"),
  ]);

  assert.equal(grouped[0]?.count, 2);
  assert.equal(grouped[0]?.subjects.length, 2);
});

test("senders keep the order their mail arrived in", () => {
  const grouped = bySender([
    message("Google Cloud", "Welcome"),
    message("Northwind Insurance", "Your policy"),
    message("Google Cloud", "Second note"),
  ]);

  assert.deepEqual(grouped.map((one) => one.sender), ["Google Cloud", "Northwind Insurance"]);
  assert.equal(grouped[0]?.count, 2);
});

test("mail with no sender is attributed to someone rather than to nothing", () => {
  const grouped = bySender([message(undefined, "No sender"), message("   ", "Blank sender")]);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0]?.sender, "someone");
  assert.equal(grouped[0]?.count, 2);
});

test("an empty inbox groups into nothing", () => {
  assert.deepEqual(bySender([]), []);
});

test("small counts are spoken as words", () => {
  assert.equal(inWords(1), "one");
  assert.equal(inWords(2), "two");
  assert.equal(inWords(11), "11");
});
