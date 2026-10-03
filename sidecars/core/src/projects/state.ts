export type Project = {
  name: string;
  path: string;
  branch: string;
  /// The branch it tracks, when it tracks one. A branch with no upstream has never been pushed.
  upstream?: string;
  ahead: number;
  behind: number;
  /// How many paths are not committed, staged or otherwise.
  dirty: number;
  lastAt?: number;
  lastSaid?: string;
};

export type Standing = Pick<Project, "branch" | "upstream" | "ahead" | "behind" | "dirty">;

export const DETACHED = "(detached)";

/// What separates the fields of the one-line log format. A unit separator cannot appear in a
/// commit subject, and unlike a null byte it can be passed to a process as part of an argument.
export const APART = "\u001f";

/// Reads `git status --porcelain=v2 --branch`, which says everything about where a repository
/// stands in one call: the branch, what it tracks, how far it has run ahead, and what is not
/// committed.
export function readStatus(text: string): Standing {
  const standing: Standing = { branch: DETACHED, ahead: 0, behind: 0, dirty: 0 };

  for (const line of text.split("\n")) {
    if (line === "") continue;

    if (line.startsWith("# branch.head ")) {
      standing.branch = line.slice("# branch.head ".length).trim();
      continue;
    }
    if (line.startsWith("# branch.upstream ")) {
      standing.upstream = line.slice("# branch.upstream ".length).trim();
      continue;
    }
    if (line.startsWith("# branch.ab ")) {
      const counts = line.slice("# branch.ab ".length).trim().split(/\s+/);
      standing.ahead = Math.abs(Number(counts[0] ?? 0)) || 0;
      standing.behind = Math.abs(Number(counts[1] ?? 0)) || 0;
      continue;
    }
    // Anything that is not a header is a path that has been touched: changed, renamed, unmerged
    // or untracked. Which kind it is does not change the answer to whether the tree is clean.
    if (!line.startsWith("#")) standing.dirty += 1;
  }

  return standing;
}

/// Reads the one-line log format, which is when work last happened and what it was.
export function readLast(text: string): { lastAt?: number; lastSaid?: string } {
  const [when, said] = text.trim().split(APART);
  const at = Number(when);
  if (!Number.isFinite(at) || at <= 0) return {};
  return { lastAt: at * 1000, lastSaid: (said ?? "").trim() || undefined };
}
