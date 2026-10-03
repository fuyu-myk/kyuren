/// A coding agent's session on this Mac, as the island shows it. Read from what each harness
/// leaves on disk: that a session is there and when it last moved, never what was said in it.
export type Harness = "claude" | "codex" | "gemini" | "antigravity" | "pi";
export type State = "working" | "waiting" | "idle";

export type Coding = {
  id: string;
  harness: Harness;
  project: string;
  /// The session's own name, where the harness gives it one.
  title?: string;
  state: State;
  /// What it is waiting for, in the harness's own words.
  waitingFor?: string;
  started?: number;
  /// When it last showed a sign of life, in epoch milliseconds.
  active: number;
  /// Where it was started from: the desktop app, an editor, a terminal.
  via?: string;
  /// Its process, where the harness records it, by which the app it runs in is found.
  pid?: number;
};

const RANK: Record<State, number> = { waiting: 0, working: 1, idle: 2 };

/// What waits on the user first, then what is working, then the rest; newest first in each.
export function ordered(sessions: Coding[]): Coding[] {
  return [...sessions].sort((a, b) => RANK[a.state] - RANK[b.state] || b.active - a.active);
}
