import { useCallback, useEffect, useState } from "react";
import { ambientRecent, onPresence, type Firing } from "@/ambient";
import { clockOf, sayingOf, stillWorth } from "@/news";

/// What the rules have surfaced lately, on the front page, while it is still worth a glance. Live:
/// a firing appears the moment it fires and leaves when it is no longer news.
export function Noticed() {
  const [firings, setFirings] = useState<Firing[]>([]);
  const [now, setNow] = useState(Date.now());

  const read = useCallback(async () => {
    try {
      setFirings(await ambientRecent(12));
    } catch {
      setFirings([]);
    }
  }, []);

  useEffect(() => {
    void read();
  }, [read]);

  useEffect(() => {
    let stop: (() => void) | undefined;
    void onPresence(() => void read()).then((done) => {
      stop = done;
    });
    return () => stop?.();
  }, [read]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(tick);
  }, []);

  const shown = firings.filter((one) => stillWorth(one, now));
  if (shown.length === 0) return null;

  return (
    <ul className="noticed">
      {shown.map((one) => (
        <li key={`${one.rule}-${one.at}`}>
          <span className="when">{clockOf(one)}</span>
          <span className="what">{one.title}</span>
          <span className="how">{sayingOf(one)}</span>
        </li>
      ))}
    </ul>
  );
}
