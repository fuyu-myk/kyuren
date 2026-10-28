import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Project } from "#projects/state.ts";
import { commitsOf, gatherRecap, localStamp, readCommits, readMerged, workedSince, type Readers } from "#recap/gather.ts";

const UNIT = "\u001f";
const project = (name: string, path = `/x/${name}`): Project => ({ name, path, branch: "main", ahead: 0, behind: 0, dirty: 0 });

test("the commits counted are the user's own, by the address the repository commits under", () => {
  const log = [`me@example.com${UNIT}feat: one`, `someone@example.com${UNIT}theirs`, "", `ME@example.com${UNIT} fix: two `].join("\n");
  assert.deepEqual(readCommits(log, "me@example.com"), ["feat: one", "fix: two"]);
  assert.deepEqual(readCommits(log, ""), ["feat: one", "theirs", "fix: two"], "with no address, every commit");
});

test("a repository's commits since the morning are read from its branches, newest first", async () => {
  const at = realpathSync(mkdtempSync(join(tmpdir(), "kyuren-recap-")));
  const git = (env: Record<string, string>, ...args: string[]) => execFileSync("git", ["-C", at, ...args], { stdio: "ignore", env: { ...process.env, ...env } });
  git({}, "init", "-q");
  git({}, "config", "user.email", "me@example.com");
  git({}, "config", "user.name", "me");
  const yesterday = { GIT_AUTHOR_DATE: "2026-10-27T10:00:00", GIT_COMMITTER_DATE: "2026-10-27T10:00:00" };
  const today = { GIT_AUTHOR_DATE: "2026-10-28T10:00:00", GIT_COMMITTER_DATE: "2026-10-28T10:00:00" };
  const later = { GIT_AUTHOR_DATE: "2026-10-28T11:00:00", GIT_COMMITTER_DATE: "2026-10-28T11:00:00" };
  git(yesterday, "commit", "-q", "--allow-empty", "-m", "yesterday's");
  git(today, "commit", "-q", "--allow-empty", "-m", "this morning's");
  git({ ...later, GIT_AUTHOR_EMAIL: "someone@example.com" }, "commit", "-q", "--allow-empty", "-m", "someone else's");
  git(later, "checkout", "-q", "-b", "side");
  git(later, "commit", "-q", "--allow-empty", "-m", "on a branch");
  assert.deepEqual(await commitsOf(at, new Date(2026, 9, 28)), ["on a branch", "this morning's"]);
  assert.equal(await commitsOf(join(at, "missing"), new Date(2026, 9, 28)), undefined, "no repository there");
});

test("GitHub is asked for what merged since local midnight, in its own time with the offset", () => {
  const morning = new Date(2026, 9, 28);
  const stamp = localStamp(morning);
  assert.match(stamp, /^2026-10-28T00:00:00[+-]\d{2}:\d{2}$/);
  assert.equal(new Date(stamp).getTime(), morning.getTime());
});

test("a merged pull request is kept only with a link to itself on GitHub", () => {
  const one = (repo: string, number: number, url = `https://github.com/${repo}/pull/${number}`) => ({ number, title: `t${number}`, url, repository: { nameWithOwner: repo } });
  assert.deepEqual(readMerged([one("me/kyuren", 41), one("me/kyuren", 42, "https://elsewhere.example/42"), one("bad repo/x", 3)]), [
    { repo: "me/kyuren", number: 41, title: "t41", url: "https://github.com/me/kyuren/pull/41" },
  ]);
  assert.equal(readMerged({ not: "a list" }), undefined);
});

test("the sessions counted are Claude Code's transcripts written since the morning, under the project they worked in", async () => {
  const coding = realpathSync(mkdtempSync(join(tmpdir(), "kyuren-coding-")));
  const alpha = join(coding, "alpha");
  const spare = join(alpha, ".claude", "worktrees", "spare");
  const beta = join(coding, "alpha-beta");
  for (const folder of [spare, beta]) mkdirSync(folder, { recursive: true });

  const transcripts = realpathSync(mkdtempSync(join(tmpdir(), "kyuren-transcripts-")));
  const dashed = (path: string) => path.replace(/[^A-Za-z0-9]/g, "-");
  const write = (folder: string, name: string, old = false) => {
    const dir = join(transcripts, dashed(folder));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), "{}\n");
    if (old) utimesSync(join(dir, name), new Date(2026, 0, 1), new Date(2026, 0, 1));
  };
  write(alpha, "0b8c1f2e-1111-4222-8333-944455556666.jsonl");
  write(alpha, "1b8c1f2e-1111-4222-8333-944455556666.jsonl", true);
  write(alpha, "notes.txt");
  write(spare, "2b8c1f2e-1111-4222-8333-944455556666.jsonl");
  write(beta, "3b8c1f2e-1111-4222-8333-944455556666.jsonl");
  write(join(coding, "elsewhere"), "4b8c1f2e-1111-4222-8333-944455556666.jsonl");

  const worked = await workedSince([project("alpha", alpha), project("alpha-beta", beta)], new Date(2026, 5, 1), transcripts);
  assert.deepEqual(worked, [{ project: "alpha", sessions: 2 }, { project: "alpha-beta", sessions: 1 }]);
});

test("a recap puts the busiest project first and says what could not be read", async () => {
  const readers: Readers = {
    projects: async () => [project("quiet"), project("one"), project("busy")],
    commits: async (path) => ({ "/x/one": ["a"], "/x/busy": ["c", "b"] })[path] ?? [],
    merged: async () => undefined,
    made: async () => [{ project: "busy", topic: "Store", said: "SQLite" }],
    worked: async () => [{ project: "busy", sessions: 3 }],
  };
  const recap = await gatherRecap(new Date(2026, 9, 28, 18, 0), readers);
  assert.equal(recap.day, "2026-10-28");
  assert.deepEqual(recap.committed, [{ project: "busy", said: ["c", "b"] }, { project: "one", said: ["a"] }]);
  assert.deepEqual(recap.merged, []);
  assert.deepEqual(recap.missing, ["GitHub"]);
  assert.deepEqual(recap.made, [{ project: "busy", topic: "Store", said: "SQLite" }]);
  assert.deepEqual(recap.worked, [{ project: "busy", sessions: 3 }]);
});
