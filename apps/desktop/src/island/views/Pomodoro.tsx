import { useEffect, useState } from "react";
import { countdown, remaining, type Clock } from "@/island/glance";

export type Timer = {
  clock: Clock;
  start: () => void;
  pause: () => void;
  reset: () => void;
  period: (period: Clock["period"]) => void;
};

const PERIODS: Array<[Clock["period"], string, string]> = [
  ["focus", "focus", "M8 2.5a5.5 5.5 0 1 0 0 11a5.5 5.5 0 1 0 0-11Z M8 5.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5Z"],
  ["short", "short break", "M3 6h8v3.5a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3Z M11 7h.8a1.6 1.6 0 0 1 0 3.2H11 M5.6 2.6v1.6 M8.2 2.6v1.6"],
  ["long", "long break", "M2 12.5V4.5 M2 9.5h12v3 M14 9.5V8.3a2 2 0 0 0-2-2H7.2v3.2 M4.6 6.9a1.2 1.2 0 1 0 0 2.4a1.2 1.2 0 1 0 0-2.4Z"],
];

function Icon({ d, filled = false }: { d: string; filled?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d={d} fill={filled ? "currentColor" : "none"} stroke={filled ? "none" : "currentColor"} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/// A focus timer: the period, how far through the set, the time left, and start, pause and reset.
export function Pomodoro({ timer }: { timer: Timer }) {
  const { clock } = timer;
  const running = clock.endsAt !== null;
  // The clock is read at every drawing, so a start or a resume shows the right time at once; the
  // interval only asks for the drawing.
  const [, redraw] = useState(0);
  useEffect(() => {
    if (!running) return;
    const ticking = setInterval(() => redraw((count) => count + 1), 250);
    return () => clearInterval(ticking);
  }, [running]);
  const now = Date.now();

  return (
    <div className="widget pomodoro">
      <div className="periods">
        {PERIODS.map(([period, title, d]) => (
          <button key={period} type="button" title={title} className={period === clock.period ? "period on" : "period"} onClick={() => timer.period(period)}>
            <Icon d={d} />
          </button>
        ))}
      </div>
      <div className="dots" aria-label={`${clock.done} of 4 focus periods done`}>
        {[0, 1, 2, 3].map((one) => (
          <span key={one} className={one < clock.done ? "dot on" : "dot"} />
        ))}
      </div>
      <div className="time">{countdown(remaining(clock, now))}</div>
      <div className="controls">
        <button type="button" className="go" title={running ? "pause" : "start"} onClick={running ? timer.pause : timer.start}>
          <Icon d={running ? "M5 4h2.2v8H5z M8.8 4H11v8H8.8z" : "M5.5 3.8l6.3 4.2-6.3 4.2Z"} filled />
        </button>
        <button type="button" title="start the period over" onClick={timer.reset}>
          <Icon d="M12.4 8.2a4.4 4.4 0 1 1-1.4-3.4 M12.6 2.8v2.6H10" />
        </button>
      </div>
    </div>
  );
}
