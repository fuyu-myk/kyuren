/// How a coding session's turn went, in counts alone, as the core reads them from its transcript.
export type Outcome = { tests: { passed: number | null; failed: number | null; ok: boolean } | null; files: number };
/// A Claude Code session's turn that ended after working a while.
export type Finished = { session: string; project: string; title?: string; worked: number; outcome: Outcome | null };

function workedFor(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `after ${seconds} seconds`;
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? "after a minute" : `after ${minutes} minutes`;
}

/// A finished turn told in a line either side of the notch: whose it was, then how its tests went
/// and how many files it changed, or how long it worked when there is nothing to count.
export function toldOf(finished: Finished): { who: string; how: string; state: "healthy" | "failed" | null } {
  const tests = finished.outcome?.tests ?? null;
  const files = finished.outcome?.files ?? 0;
  const parts: string[] = [];
  if (tests) {
    if (tests.ok) parts.push(tests.passed !== null ? `${tests.passed} passed` : "tests passed");
    else parts.push(tests.failed ? `${tests.failed} failed` : "tests failed");
  }
  if (files > 0) parts.push(`${files} ${files === 1 ? "file" : "files"} changed`);
  return {
    who: `${finished.project} finished`,
    how: parts.length > 0 ? parts.join(" · ") : workedFor(finished.worked),
    state: tests ? (tests.ok ? "healthy" : "failed") : null,
  };
}
