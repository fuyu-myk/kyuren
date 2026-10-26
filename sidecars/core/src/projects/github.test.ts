import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Board } from "#projects/board.ts";
import { githubOf, readGitHub, type GitHub } from "#projects/github.ts";

test("a repository's place on GitHub is read from where its origin points, and one elsewhere has none", () => {
  assert.equal(githubOf("https://github.com/fuyu-myk/kyuren.git"), "fuyu-myk/kyuren");
  assert.equal(githubOf("https://github.com/fuyu-myk/kyuren"), "fuyu-myk/kyuren");
  assert.equal(githubOf("git@github.com:fuyu-myk/mmcif.git\n"), "fuyu-myk/mmcif");
  assert.equal(githubOf("ssh://git@github.com/fuyu-myk/fractal.db.git"), "fuyu-myk/fractal.db");
  for (const elsewhere of ["https://gitlab.com/fuyu/kyuren.git", "https://github.com.evil.example/a/b", "https://github.com/a/b/c", "https://github.com/a;rm/b", ""]) {
    assert.equal(githubOf(elsewhere), undefined, elsewhere);
  }
});

const ROLLUP = (state: string | null) => ({ commits: { nodes: [{ commit: { statusCheckRollup: state ? { state } : null } }] } });

test("GitHub's answer is read as the board shows it: open pull requests with how their checks stand, and the main branch's", () => {
  const answer = {
    data: {
      repository: {
        defaultBranchRef: { name: "main", target: { statusCheckRollup: { state: "FAILURE" } } },
        pullRequests: {
          totalCount: 12,
          nodes: [
            { number: 41, title: "Shelf on SQLite", url: "https://github.com/fuyu-myk/kyuren/pull/41", isDraft: false, ...ROLLUP("SUCCESS") },
            { number: 40, title: "Try the wake word", url: "https://github.com/fuyu-myk/kyuren/pull/40", isDraft: true, ...ROLLUP("PENDING") },
            { number: 39, title: "No checks yet", url: "https://github.com/fuyu-myk/kyuren/pull/39", isDraft: false, ...ROLLUP(null) },
            { number: 38, title: "Broken", url: "https://github.com/fuyu-myk/kyuren/pull/38", isDraft: false, ...ROLLUP("ERROR") },
          ],
        },
      },
    },
  };
  assert.deepEqual(readGitHub(answer, "fuyu-myk/kyuren"), {
    repo: "fuyu-myk/kyuren",
    branch: "main",
    main: "failing",
    count: 12,
    pulls: [
      { number: 41, title: "Shelf on SQLite", url: "https://github.com/fuyu-myk/kyuren/pull/41", draft: false, checks: "passing" },
      { number: 40, title: "Try the wake word", url: "https://github.com/fuyu-myk/kyuren/pull/40", draft: true, checks: "pending" },
      { number: 39, title: "No checks yet", url: "https://github.com/fuyu-myk/kyuren/pull/39", draft: false, checks: "none" },
      { number: 38, title: "Broken", url: "https://github.com/fuyu-myk/kyuren/pull/38", draft: false, checks: "failing" },
    ],
  });
  assert.equal(readGitHub({ data: { repository: null } }, "a/b"), undefined, "a repository GitHub does not show this user");
  assert.equal(readGitHub({ errors: [{ message: "Bad credentials" }] }, "a/b"), undefined);
  const elsewhere = { data: { repository: { defaultBranchRef: null, pullRequests: { totalCount: 0, nodes: [{ number: 1, title: "x", url: "https://evil.example/pull/1", isDraft: false, ...ROLLUP(null) }] } } } };
  assert.deepEqual(readGitHub(elsewhere, "a/b")?.pulls, [], "a link that does not lead to GitHub is not shown");
});

test("the board shows what GitHub says once it has been read, without waiting on it", async () => {
  const root = await mkdtemp(join(tmpdir(), "kyuren-board-"));
  await mkdir(join(root, "kyuren", ".git"), { recursive: true });
  const github: GitHub = { repo: "fuyu-myk/kyuren", branch: "main", main: "passing", count: 0, pulls: [] };
  let asked = 0;
  const board = new Board(root, async () => {
    asked += 1;
    return github;
  });
  const first = await board.projects(true);
  assert.equal(first[0]?.github, undefined, "the board is not held up while GitHub is asked");
  for (let tries = 0; tries < 100 && asked === 0; tries += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  await new Promise((resolve) => setTimeout(resolve, 20));
  const second = await board.projects(true);
  assert.deepEqual(second[0]?.github, github);
  await board.projects(true);
  assert.equal(asked, 1, "asked again only once its reading is old");
});
