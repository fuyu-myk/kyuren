import { useState } from "react";
import { ceiling, nearest, rate, type Traffic } from "@/island/glance";

const WIDTH = 150;
const HEIGHT = 128;
const MIDDLE = HEIGHT / 2;
/// The graph holds two minutes, a sample a second, newest at the right edge.
const SPAN = 120;
const STEP = WIDTH / (SPAN - 1);
/// Nearer the left edge than this, the rates under the cursor are written to its right instead.
const ROOM = 66;

/// Upload above the line and download below it, on one scale, with the rates now beside it. Under
/// the cursor, a line through the moment it points at, with that moment's rates written beside the
/// line and how long ago it was.
export function NetworkGraph({ traffic }: { traffic: Traffic[] }) {
  const [pointing, setPointing] = useState<number | null>(null);
  const shown = traffic.slice(-SPAN);
  const top = ceiling(shown);
  const start = WIDTH - (shown.length - 1) * STEP;
  const x = (at: number) => start + at * STEP;
  const lift = (bytes: number) => (bytes / top) * (MIDDLE - 3);
  const line = (sign: number, pick: (one: Traffic) => number) =>
    shown.map((one, at) => `${x(at).toFixed(1)},${(MIDDLE - sign * lift(pick(one))).toFixed(1)}`).join(" ");

  const latest = shown[shown.length - 1];
  const picked = pointing === null || shown.length === 0 ? -1 : nearest(pointing - start, WIDTH - start, shown.length);
  const sample = picked >= 0 ? shown[picked] : undefined;
  const ago = sample ? Math.round((Date.now() - sample.at) / 1000) : null;
  const at = picked >= 0 ? x(picked) : 0;
  const leftOf = at >= ROOM;
  const beside = { x: leftOf ? at - 4 : at + 4, textAnchor: leftOf ? ("end" as const) : ("start" as const) };

  return (
    <div className="widget network">
      <span className="rate up">↑{rate(latest?.up ?? 0)}</span>
      <svg
        width={WIDTH}
        height={HEIGHT}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        onMouseMove={(event) => setPointing(event.clientX - event.currentTarget.getBoundingClientRect().left)}
        onMouseLeave={() => setPointing(null)}
      >
        <line className="middle" x1="0" x2={WIDTH} y1={MIDDLE} y2={MIDDLE} />
        {shown.length > 1 ? <polyline className="up" points={line(1, (one) => one.up)} /> : null}
        {shown.length > 1 ? <polyline className="down" points={line(-1, (one) => one.down)} /> : null}
        {sample ? (
          <>
            <line className="cursor" x1={at} x2={at} y1="0" y2={HEIGHT} />
            <text className="at up" x={beside.x} y={12} textAnchor={beside.textAnchor}>
              ↑{rate(sample.up)}
            </text>
            <text className="at down" x={beside.x} y={HEIGHT - 5} textAnchor={beside.textAnchor}>
              ↓{rate(sample.down)}
            </text>
          </>
        ) : null}
      </svg>
      <span className="rate down">↓{rate(latest?.down ?? 0)}</span>
      {ago !== null ? <span className="ago">{ago <= 1 ? "now" : `${ago} s ago`}</span> : null}
    </div>
  );
}
