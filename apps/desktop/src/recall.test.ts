import assert from "node:assert/strict";
import { test } from "node:test";
import { recalled, sentIn } from "./recall.ts";

const sent = ["first", "second", "third"];

test("up walks back from the newest prompt to the oldest, and no further", () => {
  const one = recalled(sent, undefined, -1, "");
  assert.equal(one?.text, "third");
  const two = recalled(sent, one!.walk, -1, "third");
  assert.equal(two?.text, "second");
  const three = recalled(sent, two!.walk, -1, "second");
  assert.equal(three?.text, "first");
  assert.equal(recalled(sent, three!.walk, -1, "first"), undefined, "there is nothing before the first");
});

test("down walks forward again, and past the newest gives back what was being written", () => {
  const back = recalled(sent, undefined, -1, "half a tho");
  const further = recalled(sent, back!.walk, -1, "third");
  const forward = recalled(sent, further!.walk, 1, "second");
  assert.equal(forward?.text, "third");
  const home = recalled(sent, forward!.walk, 1, "third");
  assert.deepEqual(home, { walk: undefined, text: "half a tho" });
  assert.equal(recalled(sent, undefined, 1, "half a tho"), undefined, "down with no walk begun goes nowhere");
});

test("nothing sent yet gives nothing to recall", () => {
  assert.equal(recalled([], undefined, -1, "draft"), undefined);
});

test("what a session sent is its own turns, a prompt said twice in a row kept once", () => {
  const turns = [
    { role: "user", text: "weather" },
    { role: "assistant", text: "31 degrees" },
    { role: "user", text: "weather" },
    { role: "user", text: "and tomorrow" },
  ];
  assert.deepEqual(sentIn(turns), ["weather", "and tomorrow"]);
});
