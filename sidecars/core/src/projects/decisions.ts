import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, realpath } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

const run = promisify(execFile);

/// A decision made on the island about a project: a question a coding agent asked, answered, or a
/// plan approved, with when, what it was about and what was decided.
export type Decision = { at: number; kind: "choice" | "plan"; topic: string; question?: string; said: string };

/// A project's latest decisions, newest first, and how many it has in all.
export type Decided = { count: number; latest: Decision[] };

/// The longest title a plan is kept under.
const TITLE = 200;

const LINE = z.object({
  at: z.number(),
  kind: z.enum(["choice", "plan"]),
  topic: z.string().max(400),
  question: z.string().max(400).optional(),
  said: z.string().max(2_000),
});

/// The repository a folder belongs to, as the board knows it: for a worktree, the repository it
/// was made from, and a folder in none its own.
export async function rootOf(folder: string): Promise<string> {
  const common = await run("git", ["-C", folder, "rev-parse", "--path-format=absolute", "--git-common-dir"], { timeout: 5_000 }).then(
    (done) => done.stdout.trim(),
    () => "",
  );
  const root = common ? dirname(common) : folder;
  return realpath(root).catch(() => root);
}

/// Where a repository's decisions are kept, in Kyuren's own folder: named for the repository, and
/// for its whole path, since two may share a name.
export function decisionsFile(home: string, root: string): string {
  const mark = createHash("sha256").update(root).digest("hex").slice(0, 12);
  return join(home, "decisions", `${basename(root)}-${mark}.jsonl`);
}

/// Keeps decisions made about the repository a folder belongs to.
export async function noteDecisions(home: string, folder: string, made: Decision[]): Promise<void> {
  const root = await rootOf(folder);
  const file = decisionsFile(home, root);
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  await appendFile(file, made.map((one) => `${JSON.stringify({ ...one, root })}\n`).join(""), { mode: 0o600 });
}

/// A repository's latest decisions, newest first, and how many there are; a line that does not
/// read as one is passed over.
export async function decisionsAt(home: string, root: string, most: number): Promise<Decided> {
  const text = await readFile(decisionsFile(home, await realpath(root).catch(() => root)), "utf8").catch(() => "");
  const all: Decision[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const one = LINE.safeParse(parsed);
    if (one.success) all.push(one.data);
  }
  return { count: all.length, latest: all.slice(-most).reverse() };
}

/// A plan as the record names it: its first line, without the marks that make it a heading or an
/// item, as long as a title runs.
export function planTitle(plan: string): string {
  const first = plan.split("\n").find((line) => line.trim() !== "") ?? "";
  return first.replace(/^\s*(#+|[-*]|\d+\.)\s*/, "").trim().slice(0, TITLE);
}
