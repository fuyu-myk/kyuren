import { execFile } from "node:child_process";
import { basename } from "node:path";
import { promisify } from "node:util";
import { repositories } from "#projects/find.ts";
import { inHandfuls } from "#projects/pool.ts";
import { readLast, readStatus, type Project } from "#projects/state.ts";

const run = promisify(execFile);

/// How many repositories are read at once, and how long a reading stands before it is taken again.
export const TOGETHER = 8;
export const STALE = 15_000;

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
  private held: Project[] = [];
  private read = 0;
  private reading: Promise<Project[]> | undefined;

  constructor(root: string) {
    this.root = root;
  }

  async projects(fresh = false): Promise<Project[]> {
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

  private async scan(): Promise<Project[]> {
    const where = await repositories(this.root);
    const found = await inHandfuls(where, TOGETHER, stateOf);
    // Whatever was worked on last is what is wanted first.
    return found.sort((one, two) => (two.lastAt ?? 0) - (one.lastAt ?? 0));
  }
}
