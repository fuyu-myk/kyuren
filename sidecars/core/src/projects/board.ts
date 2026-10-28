import { execFile } from "node:child_process";
import { basename } from "node:path";
import { promisify } from "node:util";
import { repositories } from "#projects/find.ts";
import type { Decided } from "#projects/decisions.ts";
import { githubAt, type GitHub } from "#projects/github.ts";
import { inHandfuls } from "#projects/pool.ts";
import { readLast, readStatus, type Project } from "#projects/state.ts";

const run = promisify(execFile);

/// How many repositories are read at once, and how long a reading stands before it is taken again.
export const TOGETHER = 8;
export const STALE = 15_000;

/// How long what GitHub said of a repository stands before it is asked again, how many are asked at
/// once, and how long a reading is still shown when asking again fails, before it is too old to.
export const HUB_STALE = 3 * 60_000;
const HUB_TOGETHER = 4;
const HUB_KEPT = 15 * 60_000;

/// Long enough for a slow disk, short enough that one wedged repository does not hold up the
/// board for everything else.
const PATIENCE = 8_000;

async function git(where: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", ["-C", where, ...args], {
    timeout: PATIENCE,
    maxBuffer: 4_000_000,
  });
  return stdout;
}

export async function stateOf(path: string): Promise<Project> {
  const name = basename(path);
  try {
    const [status, last] = await Promise.all([
      git(path, ["status", "--porcelain=v2", "--branch"]),
      // The separator is asked for as a byte git writes itself, because an argument cannot carry
      // one and a subject could contain anything else.
      git(path, ["log", "-1", "--format=%ct%x1f%s"]).catch(() => ""),
    ]);
    return { name, path, ...readStatus(status), ...readLast(last) };
  } catch {
    // A folder that cannot be read is still a folder that is there. Leaving it off the board
    // would be quietly saying it does not exist.
    return { name, path, branch: "unreadable", ahead: 0, behind: 0, dirty: 0 };
  }
}

/// Where every project stands, read a handful at a time and held for a moment.
///
/// The pane asks whenever it is opened and on a timer, and forty repositories is eighty processes;
/// reading them afresh every time would keep the disk busy for nothing.
export class Board {
  private readonly root: string;
  private readonly github: (path: string) => Promise<GitHub | undefined>;
  private readonly decided: (path: string) => Promise<Decided | undefined>;
  private held: Project[] = [];
  private read = 0;
  private reading: Promise<Project[]> | undefined;
  /// What GitHub said of each repository, asked in the background so the board never waits on the
  /// network: when it was asked, and when it last answered.
  private readonly hub = new Map<string, { data?: GitHub; asked: number; answered: number }>();
  private hubbing = false;

  constructor(
    root: string,
    github: (path: string) => Promise<GitHub | undefined> = githubAt,
    decided: (path: string) => Promise<Decided | undefined> = async () => undefined,
  ) {
    this.root = root;
    this.github = github;
    this.decided = decided;
  }

  async projects(fresh = false): Promise<Project[]> {
    const projects = await this.local(fresh);
    this.askGitHub(projects);
    return Promise.all(
      projects.map(async (one) => {
        const data = this.hub.get(one.path)?.data;
        const decided = await this.decided(one.path).catch(() => undefined);
        return { ...one, ...(data ? { github: data } : {}), ...(decided && decided.count > 0 ? { decisions: decided } : {}) };
      }),
    );
  }

  private async local(fresh: boolean): Promise<Project[]> {
    if (this.reading) return this.reading;
    if (!fresh && this.held.length > 0 && Date.now() - this.read < STALE) return this.held;

    this.reading = this.scan();
    try {
      this.held = await this.reading;
      this.read = Date.now();
      return this.held;
    } finally {
      this.reading = undefined;
    }
  }

  /// Asks GitHub again about the repositories whose reading is old, a few at a time, while the
  /// board goes on without it. A reading that could not be renewed is shown a while longer, then
  /// dropped rather than shown as current.
  private askGitHub(projects: Project[]): void {
    if (this.hubbing) return;
    const now = Date.now();
    const due = projects.filter((one) => now - (this.hub.get(one.path)?.asked ?? 0) >= HUB_STALE).map((one) => one.path);
    if (due.length === 0) return;
    this.hubbing = true;
    void inHandfuls(due, HUB_TOGETHER, async (path) => {
      const was = this.hub.get(path);
      const data = await this.github(path).catch(() => undefined);
      const at = Date.now();
      if (data) this.hub.set(path, { data, asked: at, answered: at });
      else this.hub.set(path, { ...(was?.data && at - was.answered < HUB_KEPT ? { data: was.data } : {}), asked: at, answered: was?.answered ?? 0 });
    }).finally(() => {
      this.hubbing = false;
    });
  }

  private async scan(): Promise<Project[]> {
    const where = await repositories(this.root);
    const found = await inHandfuls(where, TOGETHER, stateOf);
    // Whatever was worked on last is what is wanted first.
    return found.sort((one, two) => (two.lastAt ?? 0) - (one.lastAt ?? 0));
  }
}
