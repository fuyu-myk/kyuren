import assert from "node:assert/strict";
import { test } from "node:test";
import { secondsLeft, waitingBesides, type AgentAsk } from "./asks.ts";

const ask: AgentAsk = { id: "a", harness: "claude", session: "s1", project: "kyuren", tool: "Bash", verb: "run", target: "make", at: 0, until: 45_000 };

test("a question counts down to when Claude Code asks it itself", () => {
  assert.equal(secondsLeft(ask, 0), 45);
  assert.equal(secondsLeft(ask, 44_001), 1);
  assert.equal(secondsLeft(ask, 46_000), 0);
});

test("a session waiting because its question is on the island is not counted twice", () => {
  const sessions = [
    { id: "s1", state: "waiting" as const },
    { id: "s2", state: "waiting" as const },
    { id: "s3", state: "working" as const },
  ];
  assert.equal(waitingBesides(sessions, [ask]), 1);
  assert.equal(waitingBesides(sessions, []), 2);
});
