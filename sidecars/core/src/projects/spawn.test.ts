import assert from "node:assert/strict";
import { test } from "node:test";
import { argsFor, readResult } from "#projects/spawn.ts";

test("what a finished session said is read out of its report", () => {
  const read = readResult(JSON.stringify({
    type: "result",
    is_error: false,
    num_turns: 3,
    result: "The parser is where it stopped; two tests are failing.",
    total_cost_usd: 0.42,
  }));

  assert.equal(read.said, "The parser is where it stopped; two tests are failing.");
  assert.equal(read.ok, true);
  assert.equal(read.turns, 3);
  assert.equal(read.cost, 0.42);
});

test("a session that failed still said why", () => {
  const read = readResult(JSON.stringify({ is_error: true, result: "no such directory" }));
  assert.equal(read.ok, false);
  assert.equal(read.said, "no such directory");
});

test("something that is not a report is kept as it is", () => {
  const read = readResult("command not found: claude\n");
  assert.equal(read.said, "command not found: claude");
  assert.equal(read.ok, true, "it said something, which is not the same as having worked");
});

test("nothing said at all is not a success", () => {
  assert.equal(readResult("   ").ok, false);
});

test("a session that would not stop talking is cut off", () => {
  const read = readResult(JSON.stringify({ result: "a".repeat(80_000) }));
  assert.ok(read.said.length < 30_000, "an answer must not swallow the conversation it lands in");
});

test("a question that begins with a dash is asked, never read as a flag that changes how the session runs", () => {
  const args = argsFor("--dangerously-skip-permissions");
  assert.deepEqual(args.slice(-2), ["--", "--dangerously-skip-permissions"]);
  assert.ok(args.indexOf("plan") < args.indexOf("--"), "it plans, and nothing after the separator can say otherwise");
});
