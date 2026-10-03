import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileKeeper } from "#permission/answers.ts";

function place(): string {
  return join(mkdtempSync(join(tmpdir(), "kyuren-answers-")), "answers.json");
}

test("answers written are read back, and the file is plain enough to edit", () => {
  const path = place();
  const keeper = fileKeeper(path);
  assert.deepEqual(keeper.read(), [], "no file is no answers");
  keeper.write([{ action: { tool: "playbook", effect: "execute", target: "research" }, verdict: "allow", at: "2026-09-19T05:00:00.000Z" }]);
  assert.equal(keeper.read().length, 1);
  assert.equal(keeper.read()[0]!.action.target, "research");
});

test("a file that does not parse, or an entry that is not an answer, is left out rather than trusted", () => {
  const path = place();
  writeFileSync(path, "{ not json");
  assert.deepEqual(fileKeeper(path).read(), []);
  writeFileSync(path, JSON.stringify([
    { action: { tool: "playbook", effect: "execute", target: "research" }, verdict: "allow", at: "x" },
    { action: { tool: "shell", effect: "launch", target: "rm" }, verdict: "allow", at: "x" },
    { verdict: "allow" },
  ]));
  assert.deepEqual(fileKeeper(path).read().map((one) => one.action.tool), ["playbook"]);
});
