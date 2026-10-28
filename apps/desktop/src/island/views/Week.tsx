import { clockOf, dayName, nextEvent, sourceNames, until, type Happening, type Week as Read } from "@/island/week";

type Props = {
  week: Read | null;
  now: number;
  asking: boolean;
  onAllow: () => void;
};

/// The week across the island, today first, each day with its events, and the next one counted
/// down above them. A calendar not yet allowed is named, with a way to be asked about it.
export function Week({ week, now, asking, onAllow }: Props) {
  if (!week) return <div className="view week"><p className="quiet">reading the calendars</p></div>;

  const next = nextEvent(week, now);
  const today = week.days[0]?.day ?? "";
  const state = (one: Happening): string => {
    if (one === next) return "next";
    return one.timed && new Date(one.at).getTime() <= now ? "past" : "";
  };

  return (
    <div className="view week">
      <div className="ahead">
        {next ? (
          <p className="next">
            <span className="label">next</span>
            <span className="title">{next.title}</span>
            <span className="until">{until(next.at, now)}</span>
            <span className="at">{clockOf(next.at)}</span>
          </p>
        ) : (
          <p className="next quiet">nothing ahead this week</p>
        )}
        {week.failed.length > 0 ? <span className="trouble">{sourceNames(week.failed)} could not be read</span> : null}
        {week.refused.length > 0 ? (
          <button type="button" className="allow" disabled={asking} onClick={onAllow} title={`ask about reading ${sourceNames(week.refused)}`}>
            {asking ? "asking" : `read ${sourceNames(week.refused)}`}
          </button>
        ) : null}
      </div>
      <div className="days">
        {week.days.map((one) => (
          <section key={one.day} className={one.day === today ? "day today" : "day"}>
            <h4>{dayName(one.day, today)}</h4>
            <ul>
              {one.events.map((event) => (
                <li key={`${event.at}|${event.title}`} className={state(event)} title={`${event.title}, ${event.collection}`}>
                  <span className="time">{event.timed ? clockOf(event.at) : "all day"}</span>
                  <span className="title">{event.title}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
