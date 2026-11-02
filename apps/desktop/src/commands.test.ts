import assert from "node:assert/strict";
import { test } from "node:test";
import { offers, parseCommand, stepped, suggest, typing, type Command } from "./commands.ts";

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

test("a skill's name is offered as a command, and once typed its values are offered as hints", () => {
  const withSkill: Command[] = [
    ...commands,
    { name: "weather_now", about: "the weather", kind: "skill", parameters: [{ name: "q", in: "query", kind: "string", required: true, about: "" }], recent: { q: ["Oslo"] } },
  ];
  assert.deepEqual(offers(withSkill, "/wea").map((one) => [one.label, one.text, one.hint]), [["/weather_now", "/weather_now ", false]]);
  assert.deepEqual(offers(withSkill, "/weather_now ").map((one) => [one.label, one.text, one.hint]), [["Oslo", "/weather_now Oslo ", true]]);
  assert.deepEqual(offers(withSkill, "/today "), [], "a command that is not a skill has no hints");
});
