import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { classify } from "#permission/action.ts";
import { guarded } from "#permission/shared.ts";

const root = process.env.KYUREN_HOME ?? join(homedir(), ".kyuren");

test("no tool can write a playbook or a run log into place, however it asks", () => {
  for (const target of [
    join(root, "playbooks", "weekly-review.md"),
    join(root, "playbooks", "pending", "weekly-review.md"),
    join(root, "runs", "weekly-review", "2026-09-18.md"),
  ]) {
    assert.equal(classify({ tool: "write_file", effect: "write", target }, guarded()), "deny", target);
    assert.equal(classify({ tool: "write_file", effect: "destroy", target }, guarded()), "deny", target);
  }
  assert.equal(
    classify({ tool: "read_file", effect: "read", target: join(root, "playbooks", "weekly-review.md") }, guarded()),
    "allow",
    "reading a playbook is fine",
  );
});
