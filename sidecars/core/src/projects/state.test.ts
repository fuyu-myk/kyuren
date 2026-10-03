import assert from "node:assert/strict";
import { test } from "node:test";
import { APART, DETACHED, readLast, readStatus } from "#projects/state.ts";

test("a clean branch that is up to date says so", () => {
  const standing = readStatus([
    "# branch.oid abc123",
    "# branch.head main",
    "# branch.upstream origin/main",
    "# branch.ab +0 -0",
  ].join("\n"));

  assert.deepEqual(standing, {
    branch: "main",
    upstream: "origin/main",
    ahead: 0,
    behind: 0,
    dirty: 0,
  });
});

test("work that has not been pushed is counted", () => {
  const standing = readStatus([
    "# branch.head feature/graph",
    "# branch.upstream origin/feature/graph",
    "# branch.ab +3 -1",
  ].join("\n"));

  assert.equal(standing.ahead, 3);
  assert.equal(standing.behind, 1);
});

test("every touched path counts, whatever kind of touched it is", () => {
  const standing = readStatus([
    "# branch.head main",
    "1 .M N... 100644 100644 100644 aaa bbb src/one.ts",
    "1 M. N... 100644 100644 100644 ccc ddd src/two.ts",
    "2 R. N... 100644 100644 100644 eee fff R100 new.ts",
    "u UU N... 100644 100644 100644 100644 ggg hhh iii both.ts",
    "? untracked.ts",
  ].join("\n"));

  assert.equal(standing.dirty, 5);
});

test("a branch that has never been pushed has nothing to track", () => {
  const standing = readStatus("# branch.head draft");
  assert.equal(standing.branch, "draft");
  assert.equal(standing.upstream, undefined);
  assert.equal(standing.ahead, 0);
});

test("a head that is not on a branch is said to be detached", () => {
  assert.equal(readStatus("# branch.head " + DETACHED).branch, DETACHED);
});

test("nothing at all does not throw", () => {
  assert.deepEqual(readStatus(""), { branch: DETACHED, ahead: 0, behind: 0, dirty: 0 });
});

test("the last commit is read as a time and a subject", () => {
  const last = readLast("1757980800" + APART + "draw the vault as a graph");
  assert.equal(last.lastAt, 1757980800000);
  assert.equal(last.lastSaid, "draw the vault as a graph");
});

test("a repository nobody has committed to yet has no last commit", () => {
  assert.deepEqual(readLast(""), {});
  assert.deepEqual(readLast(APART), {});
});
