import { useState } from "react";
import { afterFew, FEW, More } from "@/More";
import { paneNamed } from "@/panes";
import type { Session } from "@/sessions";
import { ago } from "@/when";

type RecentProps = {
  sessions: Session[];
  /// Shown where a conversation could have come from anywhere, and left out inside one pane.
  showPane: boolean;
  empty: string;
  onOpen: (id: string) => void;
  onForget: (id: string) => void;
};

export function Recent({ sessions, showPane, empty, onOpen, onForget }: RecentProps) {
  const [asking, setAsking] = useState<string>();
  const [all, setAll] = useState(false);

  if (sessions.length === 0) {
    return <p className="empty">{empty}</p>;
  }

  const shown = all ? sessions : sessions.slice(0, FEW);

  return (
    <>
    <ul className="sessions">
      {shown.map((one, at) => (
        <li key={one.id} className={all ? "fresh" : ""} style={all ? afterFew(at) : undefined}>
          <button type="button" className="session" onClick={() => onOpen(one.id)}>
            <span className="title">{one.title}</span>
            <span className="aside">
              {showPane ? <em>{paneNamed(one.pane)?.title ?? one.pane}</em> : null}
              {one.turns} {one.turns === 1 ? "turn" : "turns"} · {ago(one.touched)}
            </span>
          </button>

          {asking === one.id ? (
            <span className="confirming">
              <button type="button" className="ghost" onClick={() => setAsking(undefined)}>
                cancel
              </button>
              <button
                type="button"
                className="ghost sure"
                onClick={() => {
                  setAsking(undefined);
                  onForget(one.id);
                }}
              >
                confirm
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="forget"
              title="forget this session"
              onClick={() => setAsking(one.id)}
            >
              forget
            </button>
          )}
        </li>
      ))}
    </ul>
    <More total={sessions.length} all={all} onToggle={() => setAll((was) => !was)} />
    </>
  );
}
