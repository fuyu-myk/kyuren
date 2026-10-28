import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Board } from "#projects/board.ts";
import { decisionsAt, decisionsFile, noteDecisions, planTitle, rootOf, type Decided } from "#projects/decisions.ts";

function repository(): string {
  const at = realpathSync(mkdtempSync(join(tmpdir(), "kyuren-decided-")));
  const git = (...args: string[]) => execFileSync("git", ["-C", at, ...args], { stdio: "ignore" });
  git("init", "-q");
  git("-c", "user.email=k@example.com", "-c", "user.name=k", "commit", "-q", "--allow-empty", "-m", "first");
  return at;
}

test("a decision is kept with the repository its session ran in, a worktree's with its own repository", async () => {
  const repo = repository();
  mkdirSync(join(repo, "src"));
  assert.equal(await rootOf(join(repo, "src")), repo);
  const worktree = join(repo, ".claude", "worktrees", "spare");
  execFileSync("git", ["-C", repo, "worktree", "add", "-q", worktree], { stdio: "ignore" });
  assert.equal(await rootOf(worktree), repo);
  const loose = realpathSync(mkdtempSync(join(tmpdir(), "kyuren-loose-")));
  assert.equal(await rootOf(loose), loose, "a folder in no repository is its own");
});

test("decisions are read back newest first, with how many there are, and a line that does not read as one is passed over", async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "kyuren-home-")));
  const repo = repository();
  await noteDecisions(home, repo, [{ at: 1, kind: "choice", topic: "Store", question: "Which store?", said: "SQLite" }]);
  await noteDecisions(home, join(repo, "."), [
    { at: 2, kind: "plan", topic: "plan approved", said: "Move the shelf" },
    { at: 3, kind: "choice", topic: "Checks", said: "Lint, a smoke test" },
  ]);
  appendFileSync(decisionsFile(home, repo), "not json\n");
  assert.deepEqual(await decisionsAt(home, repo, 2), {
    count: 3,
    latest: [
      { at: 3, kind: "choice", topic: "Checks", said: "Lint, a smoke test" },
      { at: 2, kind: "plan", topic: "plan approved", said: "Move the shelf" },
    ],
  });
  assert.deepEqual(await decisionsAt(home, "/nowhere/else", 3), { count: 0, latest: [] });
});

test("a plan is named in the record by its first line, as it is titled", () => {
  assert.equal(planTitle("\n## Move the shelf onto SQLite\n\n1. Add a table"), "Move the shelf onto SQLite");
  assert.equal(planTitle("- Tidy the build"), "Tidy the build");
  assert.equal(planTitle("x".repeat(300)).length, 200);
});

test("the board shows a project's latest decisions under it", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "kyuren-board-")));
  mkdirSync(join(root, "kyuren", ".git"), { recursive: true });
  const decided: Decided = { count: 4, latest: [{ at: 3, kind: "choice", topic: "Checks", said: "Lint" }] };
  const board = new Board(root, async () => undefined, async (path) => (path === join(root, "kyuren") ? decided : undefined));
  const [project] = await board.projects(true);
  assert.deepEqual(project?.decisions, decided);
});
