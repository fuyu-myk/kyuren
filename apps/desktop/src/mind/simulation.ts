import { build, push, type Body, type Shove } from "./quadtree.ts";
import { toward, type Spot } from "./space.ts";

export type Node = Body & {
  id: string;
  /// How far the orb stands above the surface of the whirlpool.
  lift: number;
  vx: number;
  vy: number;
  /// Where the arrangement says it belongs. Everything is drawn back to its own place, so the
  /// whirlpool keeps its shape while still giving way wherever things crowd.
  home: Spot;
  pinned: boolean;
};

export type Link = {
  from: string;
  to: string;
  strength: number;
};

export type Settings = Shove & {
  spring: number;
  /// How strongly an orb is drawn back to the place the arrangement gave it.
  home: number;
  damping: number;
  /// How quickly an orb rises to the height of its place, and the fastest it may ever travel.
  climb: number;
  fastest: number;
};

export const SETTLED: Settings = {
  repulsion: 5500,
  collide: 70,
  padding: 10,
  spring: 9,
  home: 4,
  damping: 5,
  climb: 6,
  fastest: 2000,
};

/// A long frame must not be taken at its word: a machine that stalls for a second would otherwise
/// resume with every orb thrown across the screen.
const LONGEST = 0.05;

/// New orbs start close to the middle and are thrown out to their places, which is what makes the
/// whirlpool look flung rather than assembled.
const SPAWN = 0.06;

/// Puts an orb back where it would have been born, without making a new one, so that anything
/// holding on to it is holding the same orb afterwards.
export function reseed(node: Node): void {
  node.x = node.home.x * SPAWN;
  node.y = node.home.y * SPAWN;
  node.lift = node.home.lift * SPAWN;
  node.vx = 0;
  node.vy = 0;
  node.pinned = false;
}

export function born(id: string, home: Spot, size = 0): Node {
  const node: Node = {
    id,
    x: 0,
    y: 0,
    lift: 0,
    vx: 0,
    vy: 0,
    mass: 1,
    size,
    home,
    pinned: false,
  };
  reseed(node);
  return node;
}

export function seed(homes: Map<string, Spot>): Node[] {
  return [...homes.entries()].map(([id, home]) => born(id, home));
}

/// One step of the arrangement. Deliberately a pure function of what it is given, so the same
/// whirlpool settles the same way and a test can run a hundred steps without a canvas.
export function step(
  nodes: Node[],
  links: Link[],
  seconds: number,
  settings: Settings = SETTLED,
): void {
  if (nodes.length === 0) return;
  const over = Math.min(LONGEST, seconds);

  const tree = build(nodes);
  const by = new Map(nodes.map((node) => [node.id, node]));

  for (const node of nodes) {
    if (node.pinned) continue;
    push(tree, node, settings, (fx, fy) => {
      node.vx += fx * over;
      node.vy += fy * over;
    });
  }

  for (const link of links) {
    const from = by.get(link.from);
    const to = by.get(link.to);
    if (!from || !to) continue;

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const apart = Math.sqrt(dx * dx + dy * dy) || 1e-6;
    // What two linked orbs count as the right distance is however far apart the arrangement put
    // them, so a link holds the whirlpool's own shape rather than pulling it into a lump.
    const rest = Math.hypot(to.home.x - from.home.x, to.home.y - from.home.y);
    const pull = (apart - rest) * settings.spring * link.strength * over;

    if (!from.pinned) {
      from.vx += (dx / apart) * pull;
      from.vy += (dy / apart) * pull;
    }
    if (!to.pinned) {
      to.vx -= (dx / apart) * pull;
      to.vy -= (dy / apart) * pull;
    }
  }

  const slow = Math.exp(-settings.damping * over);
  for (const node of nodes) {
    if (node.pinned) {
      node.vx = 0;
      node.vy = 0;
      continue;
    }

    node.vx = (node.vx + (node.home.x - node.x) * settings.home * over) * slow;
    node.vy = (node.vy + (node.home.y - node.y) * settings.home * over) * slow;

    const speed = Math.hypot(node.vx, node.vy);
    if (speed > settings.fastest) {
      node.vx = (node.vx / speed) * settings.fastest;
      node.vy = (node.vy / speed) * settings.fastest;
    }

    node.x += node.vx * over;
    node.y += node.vy * over;
    node.lift = toward(node.lift, node.home.lift, over, settings.climb);
  }
}

/// How much the whirlpool is still moving, so a test can say that it settles.
export function energy(nodes: Node[]): number {
  let total = 0;
  for (const node of nodes) total += node.vx * node.vx + node.vy * node.vy;
  return nodes.length === 0 ? 0 : total / nodes.length;
}
