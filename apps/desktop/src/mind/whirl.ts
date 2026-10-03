import { scatter } from "./scatter.ts";
import type { Spot } from "./space.ts";

/// A thing and what belongs to it: a person and the notes that mention them, a capability and the
/// steps running on it. Clusters are kept whole so a link is a short arc, not a long one.
export type Cluster = { head: string; members: string[] };

/// How many arms a whirlpool of a given size wants. Too many and each is a stub; too few and each
/// is a queue, and neither reads as something turning.
export function armsFor(count: number): number {
  return Math.max(3, Math.min(5, Math.ceil(count / 14)));
}

/// How far an arm turns between the middle and the rim, how far in the innermost orb sits, how far
/// an orb may stray from the line of its arm around it and across it, and how much the rim rises.
const WIND = 4.2;
const INNER = 0.44;

/// How much room is left around whatever sits in the middle, as a multiple of its own size.
///
/// Seen from above at an angle, an orb on the near or far side of the whirlpool projects much
/// closer to the middle than it really is. Without a clearing this wide, the thread joining it to
/// the middle is shorter than the glow around the middle, and the two read as one thing.
const CLEAR = 5;
const SWAY = 0.16;
const WIDTH = 0.09;
const BOWL = 0.3;

function longest(arms: string[][]): string[] {
  let fewest = arms[0]!;
  for (const arm of arms) if (arm.length < fewest.length) fewest = arm;
  return fewest;
}

/// Lays everything out as a whirlpool around the middle.
///
/// The arms are dealt evenly and each is filled from the middle outwards, so the same graph shown
/// with one layer hidden spreads into the room the hidden one left rather than keeping its gaps.
export function whirl(
  clusters: Cluster[],
  span: number,
  middle = 0,
  crowd = 0,
): Map<string, Spot> {
  // In a crowd an arm is a band rather than a line, so a thousand orbs cover the whirlpool
  // rather than queue along five wires.
  const width = WIDTH * (1 + 1.5 * crowd);
  const sway = SWAY * (1 + 0.8 * crowd);

  const held = clusters.reduce((count, one) => count + one.members.length + 1, 0);
  const arms: string[][] = Array.from({ length: armsFor(held) }, () => []);
  const dealt = [...clusters].sort(
    (one, two) => two.members.length - one.members.length || (one.head < two.head ? -1 : 1),
  );
  for (const cluster of dealt) {
    longest(arms).push(cluster.head, ...cluster.members);
  }

  const inner = Math.min(span * 0.72, Math.max(span * INNER, middle * CLEAR));

  const spots = new Map<string, Spot>();
  for (const [at, arm] of arms.entries()) {
    const base = (at / arms.length) * Math.PI * 2;
    for (const [along, id] of arm.entries()) {
      const part = arm.length === 1 ? 0.5 : along / (arm.length - 1);
      // Evenly along the arm rather than evenly over the area: an arm is a line, and orbs bunched
      // at its end read as a graph that ran out of room.
      const out = (inner + (span - inner) * part) / span;
      // An arm has width to it. Orbs strung along a bare line crowd into a queue, and a whirlpool
      // is a thing with body rather than three wires.
      const stray = (scatter(`${id} across`) - 0.5) * 2 * width * span;
      const radius = Math.min(span, Math.max(inner, span * out + stray));
      const angle = base + WIND * out + (scatter(id) - 0.5) * sway * 2;
      spots.set(id, {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        lift: BOWL * span * out * out,
      });
    }
  }

  return spots;
}

export type Tie = { from: string; to: string };

export type Belonging = { id: string; head: boolean };

/// Sorts everything into what it belongs to: a person and the notes that mention them, a
/// capability and the steps running on it. Whatever belongs to nothing stands as its own.
export function gather(things: Belonging[], ties: Tie[]): Cluster[] {
  const here = new Set(things.map((one) => one.id));
  const heads = new Map<string, Cluster>();
  for (const thing of things) {
    if (thing.head) heads.set(thing.id, { head: thing.id, members: [] });
  }

  const taken = new Set<string>();
  for (const tie of ties) {
    if (!here.has(tie.from) || !here.has(tie.to)) continue;
    const head = heads.get(tie.from) ?? heads.get(tie.to);
    if (!head) continue;

    // A note about two people belongs with the first of them. Splitting it between both would put
    // it in two places at once, and putting it between them would put it in neither.
    const member = heads.has(tie.from) ? tie.to : tie.from;
    if (heads.has(member) || taken.has(member)) continue;
    head.members.push(member);
    taken.add(member);
  }

  const loose = things
    .filter((one) => !one.head && !taken.has(one.id))
    .map((one) => ({ head: one.id, members: [] }));
  return [...heads.values(), ...loose];
}
