export type Body = {
  x: number;
  y: number;
  mass: number;
  /// How much room the body takes up, so that two of them can be kept from sitting on each other.
  size?: number;
};

/// A square of space holding either one body or four smaller squares.
type Cell = {
  x: number;
  y: number;
  size: number;
  mass: number;
  /// Centre of mass, which is what a distant cell is treated as.
  cx: number;
  cy: number;
  body?: Body;
  children?: Cell[];
};

function cell(x: number, y: number, size: number): Cell {
  return { x, y, size, mass: 0, cx: 0, cy: 0 };
}

function quadrantOf(at: Cell, body: Body): number {
  const half = at.size / 2;
  return (body.x >= at.x + half ? 1 : 0) + (body.y >= at.y + half ? 2 : 0);
}

function split(at: Cell): void {
  const half = at.size / 2;
  at.children = [
    cell(at.x, at.y, half),
    cell(at.x + half, at.y, half),
    cell(at.x, at.y + half, half),
    cell(at.x + half, at.y + half, half),
  ];
}

/// The smallest square a body can occupy before it is treated as coincident with whatever is
/// already there. Without it, two bodies at the same point split forever.
const SMALLEST = 1e-3;

function insert(at: Cell, body: Body): void {
  at.cx = (at.cx * at.mass + body.x * body.mass) / (at.mass + body.mass);
  at.cy = (at.cy * at.mass + body.y * body.mass) / (at.mass + body.mass);
  at.mass += body.mass;

  if (at.children) {
    insert(at.children[quadrantOf(at, body)]!, body);
    return;
  }

  if (!at.body) {
    at.body = body;
    return;
  }

  if (at.size <= SMALLEST) return;

  const already = at.body;
  at.body = undefined;
  split(at);
  insert(at.children![quadrantOf(at, already)]!, already);
  insert(at.children![quadrantOf(at, body)]!, body);
}

export type Tree = {
  root: Cell;
};

export function build(bodies: Body[]): Tree {
  if (bodies.length === 0) return { root: cell(0, 0, 1) };

  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const body of bodies) {
    left = Math.min(left, body.x);
    top = Math.min(top, body.y);
    right = Math.max(right, body.x);
    bottom = Math.max(bottom, body.y);
  }

  const size = Math.max(right - left, bottom - top, 1) * 1.01;
  const root = cell(left, top, size);
  for (const body of bodies) insert(root, body);
  return { root };
}

/// How far away a cell must be, relative to its size, before everything inside it is treated as
/// one body at its centre of mass. This is what turns every pair into a handful of visits.
const FAR = 0.9;

export type Shove = {
  /// How hard everything pushes everything else away, falling off with the square of the distance.
  repulsion: number;
  /// How hard two bodies already overlapping are separated, and how much room to leave between
  /// them before they are counted as overlapping at all.
  collide: number;
  padding: number;
};

/// Repulsion on one body from everything else, by way of the tree.
///
/// Crowding is answered only where a real body is met. A distant cell stands for many bodies at
/// their middle, which is near enough for repulsion and meaningless for running into something.
export function push(
  tree: Tree,
  body: Body,
  shove: Shove,
  onto: (fx: number, fy: number) => void,
): void {
  const visit = (at: Cell): void => {
    if (at.mass === 0 || at.body === body) return;

    let dx = at.cx - body.x;
    let dy = at.cy - body.y;
    let apart = Math.sqrt(dx * dx + dy * dy);

    if (apart < 1e-6) {
      // Exactly coincident bodies would divide by nothing. A fixed nudge separates them, after
      // which the ordinary force takes over.
      dx = (Math.random() - 0.5) * 1e-3;
      dy = (Math.random() - 0.5) * 1e-3;
      apart = Math.sqrt(dx * dx + dy * dy);
    }

    if (at.body || at.size / apart < FAR) {
      let force = (shove.repulsion * at.mass) / (apart * apart);
      if (at.body) {
        const room = (body.size ?? 0) + (at.body.size ?? 0) + shove.padding;
        if (apart < room) force += (room - apart) * shove.collide;
      }
      onto((-dx / apart) * force, (-dy / apart) * force);
      return;
    }

    for (const child of at.children ?? []) visit(child);
  };

  visit(tree.root);
}
