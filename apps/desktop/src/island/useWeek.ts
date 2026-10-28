import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { command, on } from "@/island/channels";
import type { Week } from "@/island/week";

/// How often the calendars are asked for again while the week shows, and how often its countdown
/// moves on.
const AGAIN = 5 * 60_000;
const TICK = 20_000;

/// The week, read while the week page or the next event's widget shows, and taken whenever the
/// core reads it for anyone. Asked for on its own it reads only the calendars already allowed;
/// `allow` asks about the rest, there being someone who pressed for it.
export function useWeek(shown: boolean): { week: Week | null; now: number; asking: boolean; allow: () => void } {
  const [week, setWeek] = useState<Week | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    const stop = on<Week>("calendar:week", setWeek);
    return () => void stop.then((unlisten) => unlisten());
  }, []);

  // Before the page is drawn, so a countdown last moved an hour ago is never shown.
  useLayoutEffect(() => {
    if (shown) setNow(Date.now());
  }, [shown]);

  useEffect(() => {
    if (!shown) return;
    const look = () => void command<Week>("calendar_week").then((read) => read && setWeek(read), () => undefined);
    look();
    const reading = setInterval(look, AGAIN);
    const ticking = setInterval(() => setNow(Date.now()), TICK);
    return () => {
      clearInterval(reading);
      clearInterval(ticking);
    };
  }, [shown]);

  const allow = useCallback(() => {
    setAsking(true);
    void command<Week>("calendar_week", { ask: true })
      .then((read) => read && setWeek(read), () => undefined)
      .finally(() => setAsking(false));
  }, []);

  return { week, now, asking, allow };
}
