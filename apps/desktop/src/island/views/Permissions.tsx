import { useEffect, useRef, useState } from "react";
import type { PermissionRequest } from "@/agent";
import { secondsLeft, summaryOf, type AgentAsk, type Decision, type Extra } from "@/island/asks";
import { Asked } from "@/island/views/Asked";
import { harnessName } from "@/island/views/Coding";

type Props = {
  alerts: PermissionRequest[];
  asks: AgentAsk[];
  pending: number;
  /// The island is open and grown, so what is here can be seen.
  shown: boolean;
  /// A word on an answer that came too late.
  note: string | null;
  onAnswer: (id: string, allow: boolean) => void;
  onAsk: (id: string, decision: Decision, extra?: Extra) => void;
  onReview: () => void;
  /// The keyboard is wanted for a form, and then no longer.
  onReach: () => void;
  onLeave: () => void;
};

/// A click this soon after the questions changed, or after they came into view, was aimed at what
/// was there before: the island may have opened under a cursor already on its way to click.
const STEADY = 450;

/// What is waiting on you: coding agents held at a permission prompt first, since each is stopped
/// until it is answered, then questions Kyuren's own gate asked, then playbooks waiting for approval.
export function Permissions({ alerts, asks, pending, shown, note, onAnswer, onAsk, onReview, onReach, onLeave }: Props) {
  const [now, setNow] = useState(Date.now());
  const [opened, setOpened] = useState<string | null>(null);
  const settled = useRef(Date.now());
  const ids = asks.map((one) => one.id).join(" ");
  useEffect(() => {
    settled.current = Date.now();
  }, [ids, shown]);
  useEffect(() => {
    if (asks.length === 0) return;
    // The clock stood still while nothing waited, so the first question would count from then.
    setNow(Date.now());
    const ticking = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(ticking);
  }, [asks.length]);

  const steady = (act: () => void) => () => {
    if (Date.now() - settled.current >= STEADY) act();
  };
  // A question past its wait has gone back to the agent, whether or not word of it has come.
  const waiting = asks.filter((one) => one.until > now);
  // Opened, a question is read whole in place of the list, until it is answered or goes back.
  const open = waiting.find((one) => one.id === opened);
  if (open) {
    return (
      <Asked
        ask={open}
        now={now}
        shown={shown}
        onAnswer={(decision, extra) => {
          setOpened(null);
          onAsk(open.id, decision, extra);
        }}
        onBack={() => setOpened(null)}
        onReach={onReach}
        onLeave={onLeave}
      />
    );
  }

  return (
    <div className="view list">
      {alerts.length === 0 && waiting.length === 0 && pending === 0 ? <p className="empty">Nothing is waiting on you.</p> : null}
      {waiting.map((one) =>
        one.kind === "permission" ? (
          <div key={one.id} className="row ask">
            <span className="what">
              <span>
                <strong>{harnessName(one.harness)}</strong> in {one.project} wants to {one.verb}
              </span>
              <span className="target whole">{one.target}</span>
            </span>
            <span className="left" title="when it asks in its own window instead">{secondsLeft(one, now)}s</span>
            <button type="button" onClick={steady(() => onAsk(one.id, "ask"))}>ask there</button>
            <button type="button" className="deny" onClick={steady(() => onAsk(one.id, "deny"))}>deny</button>
            <button type="button" className="allow" onClick={steady(() => onAsk(one.id, "allow"))}>allow</button>
          </div>
        ) : (
          <div key={one.id} className="row ask">
            <span className="what">
              <span>
                <strong>{harnessName(one.harness)}</strong> in {one.project} {summaryOf(one).wants}
              </span>
              <span className="target">{summaryOf(one).about}</span>
            </span>
            <span className="left" title="when it asks in its own window instead">{secondsLeft(one, now)}s</span>
            <button type="button" onClick={steady(() => onAsk(one.id, "ask"))}>ask there</button>
            <button type="button" className="allow" onClick={() => setOpened(one.id)}>open</button>
          </div>
        ),
      )}
      {alerts.map((one) => (
        <div key={one.id} className="row ask">
          <span className="what">
            <strong>{one.tool}</strong> wants to {one.effect}
            <span className="target whole">{one.target}</span>
            {one.carrying ? <span className="target whole carrying">sending {one.carrying}</span> : null}
            {one.why ? <span className="why">asked because {one.why}</span> : null}
          </span>
          <button type="button" className="deny" onClick={() => onAnswer(one.id, false)}>deny</button>
          <button type="button" className="allow" onClick={() => onAnswer(one.id, true)}>allow</button>
        </div>
      ))}
      {pending > 0 ? (
        <div className="row">
          <span className="what">
            {pending} playbook{pending === 1 ? "" : "s"} waiting for approval
          </span>
          <button type="button" onClick={onReview}>review</button>
        </div>
      ) : null}
      {note ? <p className="note">{note}</p> : null}
    </div>
  );
}
