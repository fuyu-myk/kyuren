import { useEffect, useState } from "react";
import { toldOf, type Finished } from "@/island/done";
import { ago } from "@/when";

/// A coding agent's session on this Mac, as the core reads it from what the harness leaves on disk.
export type Session = {
  id: string;
  harness: "claude" | "codex" | "gemini" | "antigravity" | "pi";
  project: string;
  title?: string;
  state: "working" | "waiting" | "idle";
  waitingFor?: string;
  started?: number;
  active: number;
  via?: string;
};

const HARNESS: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini",
  antigravity: "Antigravity",
  pi: "pi",
};

/// A harness by the name its users know it by.
export function harnessName(harness: string): string {
  return HARNESS[harness] ?? harness;
}

export const DOT: Record<Session["state"], string> = { working: "state running", waiting: "state waiting", idle: "state done" };

export function doing(one: Session): string {
  if (one.state === "waiting") return one.waitingFor ? `waiting for ${one.waitingFor}` : "waiting on you";
  return one.state;
}

/// How long it has been in its state: a span while it works or waits, a time once it rests.
function since(one: Session, now: number): string {
  const said = ago(one.active, now);
  if (one.state === "idle" || said === "just now") return said;
  return `for ${said.replace(/ ago$/, "")}`;
}

/// A session's turn just finished is told on its row for this long, then it is idle like any other.
const TOLD_FOR = 10 * 60_000;

/// Only Claude Code's sessions are read for more, so only theirs open.
const opens = (one: Session): boolean => one.harness === "claude";

/// The coding agents running on this Mac: what waits on you first, then what is working. A click
/// on one opens what it is doing.
type Props = { sessions: Session[]; finished: Record<string, Finished & { at: number }>; onOpen: (one: Session) => void };

export function Coding({ sessions, finished, onOpen }: Props) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const ticking = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(ticking);
  }, []);

  return (
    <div className="view list coding">
      {sessions.length === 0 ? <p className="empty">No coding agent is running.</p> : null}
      {sessions.map((one) => (
        <div
          key={`${one.harness}:${one.id}`}
          className={opens(one) ? "row opens" : "row"}
          role={opens(one) ? "button" : undefined}
          tabIndex={opens(one) ? -1 : undefined}
          onClick={opens(one) ? () => onOpen(one) : undefined}
        >
          <span className={DOT[one.state]} />
          <span className="what">
            <strong>
              {one.project}
              {one.title ? <span className="title"> {one.title}</span> : null}
            </strong>
            <span className="target">
              {one.state === "idle" && finished[one.id] && now - (finished[one.id]?.at ?? 0) < TOLD_FOR
                ? `finished: ${toldOf(finished[one.id] as Finished).how}`
                : doing(one)}
              {one.project === harnessName(one.harness) ? "" : `, ${harnessName(one.harness)}`}
              {one.via ? ` in ${one.via}` : ""}
            </span>
          </span>
          <span className="since">{since(one, now)}</span>
        </div>
      ))}
    </div>
  );
}
