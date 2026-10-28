import { clockOf, nextEvent, until, type Week } from "@/island/week";

type Props = { week: Week | null; now: number };

/// The next event on the glance: what it is, how long until it starts, and when.
export function NextEvent({ week, now }: Props) {
  const next = nextEvent(week, now);
  return (
    <div className="widget next-event">
      <span className="label">next</span>
      {next ? (
        <>
          <span className="title" title={next.title}>{next.title}</span>
          <span className="until">{until(next.at, now)}</span>
          <span className="at">{clockOf(next.at)}</span>
        </>
      ) : (
        <span className="quiet">{week ? "nothing ahead this week" : "reading the calendars"}</span>
      )}
    </div>
  );
}
