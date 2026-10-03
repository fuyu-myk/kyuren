import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { NONE, readRules } from "#ambient/rules.ts";

function file(text: string): string {
  const path = join(mkdtempSync(join(tmpdir(), "ambient-")), "ambient.json");
  writeFileSync(path, text);
  return path;
}

test("no file is no rules, and no trouble", () => {
  assert.deepEqual(readRules(join(tmpdir(), "nowhere", "ambient.json")), { rules: NONE });
});

test("a file that is not JSON is no rules, and says so", () => {
  const read = readRules(file("{ enabled: yes"));
  assert.deepEqual(read.rules, NONE);
  assert.match(read.trouble ?? "", /not JSON/);
});

test("a rule that is not a rule is no rules, and says which", () => {
  const read = readRules(file(JSON.stringify({ enabled: true, rules: [{ id: "x", when: "event" }] })));
  assert.deepEqual(read.rules, NONE);
  assert.match(read.trouble ?? "", /within/);
});

test("a good file is read with its defaults filled in", () => {
  const read = readRules(file(JSON.stringify({ enabled: true, rules: [{ id: "soon", when: "event", within: 10 }] })));
  assert.equal(read.trouble, undefined);
  assert.equal(read.rules.enabled, true);
  assert.equal(read.rules.every, 5);
  assert.deepEqual(read.rules.read, [], "nothing may be read until it is written down");
  assert.deepEqual(read.rules.rules, [{ id: "soon", when: "event", within: 10, voice: false }]);
});

// Two rules with one name would make the log say one thing and mean two.
test("two rules with the same name are refused", () => {
  const read = readRules(file(JSON.stringify({ enabled: true, rules: [{ id: "a", when: "task" }, { id: "a", when: "task" }] })));
  assert.deepEqual(read.rules, NONE);
  assert.match(read.trouble ?? "", /two rules are called a/);
});


test("schedules are read beside the rules with their defaults, and a time that is not a time is refused", () => {
  const good = readRules(file(JSON.stringify({
    enabled: true,
    schedules: [{ id: "morning", playbook: "weekly-review", at: "07:30", on: ["mon"] }],
  })));
  assert.equal(good.trouble, undefined);
  assert.deepEqual(good.rules.schedules, [
    { id: "morning", playbook: "weekly-review", at: "07:30", on: ["mon"], inputs: {}, pane: "chat", voice: false },
  ]);

  const bad = readRules(file(JSON.stringify({ enabled: true, schedules: [{ id: "morning", playbook: "weekly-review", at: "7:30am" }] })));
  assert.deepEqual(bad.rules, NONE);
  assert.match(bad.trouble ?? "", /07:30/);

  const twice = readRules(file(JSON.stringify({
    enabled: true,
    schedules: [{ id: "m", playbook: "a", at: "07:30" }, { id: "m", playbook: "b", at: "08:30" }],
  })));
  assert.deepEqual(twice.rules, NONE);
  assert.match(twice.trouble ?? "", /two schedules are called m/);
});
