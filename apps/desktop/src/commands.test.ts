import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCommand, stepped, suggest, typing, type Command } from "./commands.ts";

const commands: Command[] = [
  { name: "today", about: "what the day holds", kind: "capability" },
  { name: "research", about: "answer a question from the web", kind: "playbook" },
  { name: "remember", about: "search the notes", kind: "capability" },
];

test("the menu opens on a slash and narrows as the word is typed", () => {
  assert.deepEqual(suggest(commands, "/").map((one) => one.name), ["remember", "research", "today"]);
  assert.deepEqual(suggest(commands, "/re").map((one) => one.name), ["remember", "research"]);
  assert.deepEqual(suggest(commands, "/RES").map((one) => one.name), ["research"]);
  assert.deepEqual(suggest(commands, "/research kalman"), [], "once the words begin, the menu is gone");
  assert.deepEqual(suggest(commands, "research"), [], "no slash, no menu");
});

test("a line is a command by its slash, with the words after it", () => {
  assert.deepEqual(parseCommand("/research how do kalman filters work"), { name: "research", text: "how do kalman filters work" });
  assert.deepEqual(parseCommand("/today"), { name: "today", text: "" });
  assert.equal(parseCommand("what is today"), undefined);
  assert.equal(typing("/re")?.open, true);
  assert.equal(typing("/re ")?.open, false);
});

test("the highlight wraps at both ends", () => {
  assert.equal(stepped(0, -1, 3), 2);
  assert.equal(stepped(2, 1, 3), 0);
  assert.equal(stepped(5, 1, 0), 0);
});
