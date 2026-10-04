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

test("no tool can write where Kyuren keeps what the user allowed, which vaults it may write, or anything else of its own", () => {
  for (const target of [
    root,
    join(root, "answers.json"),
    join(root, "vaults.json"),
    join(root, "skills.db"),
    join(root, "ambient.json"),
    join(root, "settings.json"),
    join(root, "sessions.db"),
    join(root, "audit.jsonl"),
    join(root, "bin", "kyuren-hook"),
  ]) {
    assert.equal(classify({ tool: "write_file", effect: "write", target }, guarded()), "deny", target);
  }
  const vault = [{ path: join(root, "vault"), mode: "write" as const }, ...guarded()];
  assert.equal(classify({ tool: "write_file", effect: "write", target: join(root, "vault", "note.md") }, vault), "allow", "its vault is written as ever");
});
