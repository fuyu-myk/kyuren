import assert from "node:assert/strict";
import { test } from "node:test";
import { recapTool } from "#agent/recap.ts";
import type { Recap } from "#recap/gather.ts";

const recap: Recap = {
  day: "2026-10-28",
  at: new Date(2026, 9, 28, 18, 0).getTime(),
  committed: [{ project: "kyuren", said: ["feat: the evening recap"] }],
  merged: [],
  made: [],
  worked: [],
  missing: [],
};

test("the day's work is read without a question, and told as it is written into the note", async () => {
  const asked: string[] = [];
  const tool = recapTool("/vault", async (vault) => {
    asked.push(vault);
    return { recap, note: "/vault/days/2026-10-28.md" };
  });
  assert.deepEqual(tool.describe({}), { tool: "recap", effect: "read", target: "the day's work" });
  const told = (await tool.run({}, new AbortController().signal)) as { facts: string; spoken: string; note: string };
  assert.deepEqual(asked, ["/vault"]);
  assert.equal(told.spoken, "You made 1 commit today, in kyuren.");
  assert.match(told.facts, /^## Evening/);
  assert.equal(told.note, "/vault/days/2026-10-28.md");
});
