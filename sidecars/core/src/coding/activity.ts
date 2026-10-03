import { basename, dirname, relative, sep } from "node:path";
import type { Coding, Harness } from "#coding/session.ts";

/// Where a harness writes its sessions, for one that keeps no record of which are running: such a
/// session is seen by its file being written to, and only by that.
export type Trail = {
  harness: Harness;
  root: string;
  /// How many folders below the root a session's file lies.
  depth: number;
  file: RegExp;
  /// Whether a session stays listed, as idle, after its file stops being written. One that only
  /// stands in for a better record does not: the record says when a session ends, and its file
  /// written lately does not.
  lingers?: boolean;
};

/// Written to this recently, a session is working; less recently, idle; before that, not shown.
export const WORKING_FOR = 20_000;
export const IDLE_FOR = 30 * 60_000;

const NAMED: Record<Harness, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini",
  antigravity: "Antigravity",
  pi: "pi",
};

/// Sessions from the files written to lately. A session a better source already knows is left to
/// it, and one in a folder named for its project is called by that project.
export function fromActivity(
  trails: Trail[],
  recent: Map<string, number>,
  now: number,
  projects: Map<string, string>,
  known: Set<string> = new Set(),
): Coding[] {
  const found: Coding[] = [];
  for (const [path, written] of recent) {
    const trail = trails.find((one) => path.startsWith(one.root + sep));
    if (!trail) continue;
    if (relative(trail.root, path).split(sep).length !== trail.depth + 1 || !trail.file.test(basename(path))) continue;
    const age = now - written;
    if (age > (trail.lingers === false ? WORKING_FOR : IDLE_FOR)) continue;
    const id = basename(path).replace(/\.[^.]+$/, "");
    if (known.has(id)) continue;
    const folder = projects.get(dirname(path));
    found.push({
      id,
      harness: trail.harness,
      project: folder ? basename(folder) : NAMED[trail.harness],
      state: age <= WORKING_FOR ? "working" : "idle",
      active: written,
    });
  }
  return found;
}
