import { scatter } from "./scatter.ts";

export type Mote = {
  /// Which way it went, in radians.
  angle: number;
  /// How far out it is, and how big, both in radii of the frame at the middle.
  far: number;
  size: number;
  alpha: number;
};

export const MOTES = 22;

/// How long a mote lasts before it is spent and another sets off in its place, in seconds.
export const LIFE = 3.4;

/// Where a mote is born, on the rim of the frame, and how far it can get, in radii of the frame.
export const BORN = 0.95;
export const TRAVEL = 2.3;

/// The share of a life spent coming into being, so a mote never pops in.
const KINDLE = 0.08;

/// Motes given off by the middle: each born on the rim of the frame, drifting out, and fading as
/// it goes. They are read off the clock rather than stepped and kept, so a moment gives the same
/// motes however it was reached, and there is nothing to reset when the mind is put away.
export function motesAt(moment: number): Mote[] {
  const motes: Mote[] = [];
  for (let at = 0; at < MOTES; at += 1) {
    const clock = moment + (at * LIFE) / MOTES;
    const cycle = Math.floor(clock / LIFE);
    const age = (clock - cycle * LIFE) / LIFE;
    const pace = 0.7 + 0.6 * scatter(`mote ${at} ${cycle} pace`);
    // Quick off the rim and slowing as it goes, the way something let go of drifts.
    const gone = 1 - (1 - age) * (1 - age);
    motes.push({
      angle: scatter(`mote ${at} ${cycle} way`) * Math.PI * 2,
      far: BORN + TRAVEL * pace * gone,
      size: (0.07 + 0.08 * scatter(`mote ${at} ${cycle} size`)) * (1 - 0.45 * age),
      alpha: Math.min(1, age / KINDLE) * (1 - age) * (1 - age),
    });
  }
  return motes;
}
