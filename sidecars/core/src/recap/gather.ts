import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { localStamp, today } from "#brief/day.ts";
import { folderOf } from "#coding/where.ts";
import { decisionsSince } from "#projects/decisions.ts";
import { githubOf } from "#projects/github.ts";
import { inHandfuls } from "#projects/pool.ts";
import { kyuren, sharedBoard } from "#projects/shared.ts";
import type { Project } from "#projects/state.ts";

const run = promisify(execFile);

/// Long enough for a slow network, short enough that one stuck call does not hold up the rest.
const PATIENCE = 15_000;
/// How many repositories are read at once.
const TOGETHER = 4;
/// How many merged pull requests are asked for; a day with more is not one to list.
const MERGED_MOST = 50;
const UNIT = "\u001f";
const SESSION = /^[A-Za-z0-9-]{1,100}\.jsonl$/;

/// A project's commits today, newest first, by what each said.
export type Committed = { project: string; said: string[] };
export type Merged = { repo: string; number: number; title: string; url: string };
/// A decision made on the island, about a project.
export type Made = { project: string; topic: string; said: string };
/// How many Claude Code sessions worked in a project.
export type Worked = { project: string; sessions: number };

export type Recap = {
  day: string;
  at: number;
  committed: Committed[];
  merged: Merged[];
  made: Made[];
  worked: Worked[];
  /// What could not be read, so a gap is said rather than passed off as a quiet day.
  missing: string[];
};

export type Readers = {
  projects: () => Promise<Project[]>;
  commits: (path: string, since: Date) => Promise<string[] | undefined>;
  merged: (since: Date) => Promise<Merged[] | undefined>;
  made: (since: Date) => Promise<Made[]>;
  worked: (projects: Project[], since: Date) => Promise<Worked[]>;
};

/// The commits that are the user's: those under the address the repository commits under.
export function readCommits(log: string, email: string): string[] {
  const own = email.trim().toLowerCase();
  return log
    .split("\n")
    .map((line) => line.split(UNIT))
    .filter(([by, said]) => said !== undefined && (own === "" || by?.trim().toLowerCase() === own))
    .map(([, said]) => said!.trim());
}

/// What the user committed to a repository's branches since a moment, newest first; nothing for a
/// folder git cannot read.
export async function commitsOf(path: string, since: Date): Promise<string[] | undefined> {
  const email = await run("git", ["-C", path, "config", "user.email"], { timeout: PATIENCE }).then(
    (done) => done.stdout,
    () => "",
  );
  const log = await run("git", ["-C", path, "log", "--branches", "--no-merges", `--since=${since.toISOString()}`, `--format=%ae${UNIT}%s`], {
    timeout: PATIENCE,
    maxBuffer: 2_000_000,
  }).catch(() => undefined);
  return log ? readCommits(log.stdout, email) : undefined;
}

const MERGED = z.array(
  z.object({
    number: z.number().int().positive(),
    title: z.string().max(500),
    url: z.string(),
    repository: z.object({ nameWithOwner: z.string() }),
  }),
);

/// What GitHub's search found merged, or nothing for an answer that is not one. A pull request
/// whose link does not lead to itself on GitHub is left out, since the note links to it.
export function readMerged(answer: unknown): Merged[] | undefined {
  const read = MERGED.safeParse(answer);
  if (!read.success) return undefined;
  return read.data
    .filter((one) => githubOf(`https://github.com/${one.repository.nameWithOwner}`) === one.repository.nameWithOwner && one.url === `https://github.com/${one.repository.nameWithOwner}/pull/${one.number}`)
    .map((one) => ({ repo: one.repository.nameWithOwner, number: one.number, title: one.title, url: one.url }));
}

/// The user's pull requests merged since a moment, wherever they are on GitHub; nothing when GitHub
/// cannot be asked.
export async function mergedSince(since: Date): Promise<Merged[] | undefined> {
  const asked = await run("gh", ["search", "prs", "--author=@me", `--merged-at=>=${localStamp(since)}`, "--json", "number,title,url,repository", "--limit", String(MERGED_MOST)], {
    timeout: PATIENCE,
    maxBuffer: 2_000_000,
  }).catch(() => undefined);
  if (!asked) return undefined;
  try {
    return readMerged(JSON.parse(asked.stdout));
  } catch {
    return undefined;
  }
}

/// How many Claude Code sessions worked in each project since a moment, busiest first: its
/// transcripts written since then, by when each was written, without reading one. A session in a
/// worktree or a folder within a project counts for the project.
export async function workedSince(projects: Project[], since: Date, transcripts = join(homedir(), ".claude", "projects")): Promise<Worked[]> {
  const counted = new Map<string, number>();
  const nearest = [...projects].sort((a, b) => b.path.length - a.path.length);
  for (const folder of await readdir(transcripts, { withFileTypes: true }).catch(() => [])) {
    if (!folder.isDirectory()) continue;
    const names = (await readdir(join(transcripts, folder.name)).catch(() => [] as string[])).filter((name) => SESSION.test(name));
    let fresh = 0;
    for (const name of names) {
      const written = await stat(join(transcripts, folder.name, name)).then((info) => info.mtimeMs, () => 0);
      if (written >= since.getTime()) fresh += 1;
    }
    if (fresh === 0) continue;
    const worked = await folderOf(folder.name);
    const owner = worked === undefined ? undefined : nearest.find((one) => worked === one.path || worked.startsWith(`${one.path}${sep}`));
    if (owner) counted.set(owner.name, (counted.get(owner.name) ?? 0) + fresh);
  }
  return [...counted].map(([project, sessions]) => ({ project, sessions })).sort((a, b) => b.sessions - a.sessions);
}

/// How the day went in the user's work, from the morning until now.
export async function gatherRecap(now: Date, readers: Readers): Promise<Recap> {
  const since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const projects = await readers.projects();
  const [commits, merged, made, worked] = await Promise.all([
    inHandfuls(projects, TOGETHER, (one) => readers.commits(one.path, since)),
    readers.merged(since),
    readers.made(since),
    readers.worked(projects, since),
  ]);
  const committed = projects
    .map((one, at) => ({ project: one.name, said: commits[at] ?? [] }))
    .filter((one) => one.said.length > 0)
    .sort((a, b) => b.said.length - a.said.length);
  return { day: today(now), at: now.getTime(), committed, merged: merged ?? [], made, worked, missing: merged ? [] : ["GitHub"] };
}

export function sharedReaders(): Readers {
  return {
    projects: () => sharedBoard().projects(),
    commits: commitsOf,
    merged: mergedSince,
    made: async (since) => (await decisionsSince(kyuren, since.getTime())).map(({ project, topic, said }) => ({ project, topic, said })),
    worked: (projects, since) => workedSince(projects, since),
  };
}
