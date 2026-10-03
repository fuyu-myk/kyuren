import assert from "node:assert/strict";
import { test } from "node:test";
import { bendOf, CORE, labelled, nodeAt, radiusOf, sizeOf, type Drawn } from "./render.ts";
import { Screen } from "./screen.ts";
import { born, type Node } from "./simulation.ts";
import { look, reach, START, type Seen } from "./space.ts";

const size = { width: 1000, height: 600 };

function about(id: string, weight: number, kind: Drawn["kind"] = "note"): Drawn {
  return { id, label: id, layer: "memory", kind, weight };
}

function orb(id: string, x: number, y: number, lift = 0): Node {
  const node = born(id, { x, y, lift });
  node.x = x;
  node.y = y;
  node.lift = lift;
  return node;
}

function placed(nodes: Node[]): Screen {
  const screen = new Screen();
  screen.place(nodes, START, size, 1 / 60);
  return screen;
}

test("something mentioned more is drawn larger, but not proportionally", () => {
  const small = radiusOf(4, "entity");
  const large = radiusOf(40, "entity");
  assert.ok(large > small);
  assert.ok(large < small * 4, "ten times the mentions must not be ten times the circle");
});

test("labels are dropped when there are too many or they are too small", () => {
  assert.equal(labelled(40, 1), true);
  assert.equal(labelled(1000, 1), false, "a thousand labels cost more than the arrangement");
  assert.equal(labelled(40, 0.2), false, "unreadable text is not worth drawing");
});

test("the near side of the whirlpool is drawn larger than the far side", () => {
  const near: Seen = { x: 0, y: 0, depth: 300, near: 1.3 };
  const far: Seen = { x: 0, y: 0, depth: -300, near: 0.75 };
  const one = about("a", 4);

  assert.ok(sizeOf(one, near, START, 1) > sizeOf(one, far, START, 1));
  assert.ok(sizeOf(one, far, START, 1) > 0, "the far side must still be there");
});

test("an orb still arriving is drawn smaller than one that has arrived", () => {
  const seen: Seen = { x: 0, y: 0, depth: 0, near: 1 };
  assert.ok(sizeOf(about("a", 4), seen, START, 0.3) < sizeOf(about("a", 4), seen, START, 1));
});

test("clicking finds the orb under the pointer", () => {
  const nodes = [orb("a", 240, -60), orb("b", -300, 180)];
  const screen = placed(nodes);
  const drawn = new Map([["a", about("a", 3)], ["b", about("b", 3)]]);

  const under = look(nodes[0]!, START, size);
  assert.equal(nodeAt(under, nodes, drawn, screen, START)?.id, "a");
});

test("clicking empty space finds nothing", () => {
  const nodes = [orb("a", 240, -60)];
  const screen = placed(nodes);
  const drawn = new Map([["a", about("a", 3)]]);
  assert.equal(nodeAt({ x: 5, y: 5 }, nodes, drawn, screen, START), undefined);
});

test("an orb passing in front of another is the one that gets picked", () => {
  const front = orb("front", 0, -260);
  const on = look(front, START, size);

  // The same place on the canvas, but on a level above it, so one truly passes in front of the
  // other rather than merely being drawn later.
  const behind = reach(on, 220, START, size)!;
  const back = orb("back", behind.x, behind.y, 220);

  const screen = placed([back, front]);
  const drawn = new Map([["front", about("front", 30)], ["back", about("back", 30)]]);
  const nearer = screen.at("front")!.depth > screen.at("back")!.depth ? "front" : "back";

  assert.equal(nodeAt(on, [back, front], drawn, screen, START)?.id, nearer);
});

test("a link bends the same way every time the mind is read again", () => {
  const edge = { from: "note:a", to: "person:b", strength: 1 };
  assert.deepEqual(bendOf(edge), bendOf({ ...edge }), "a link that flickers is worse than a straight one");
});

test("two links between the same pair do not lie on top of each other", () => {
  const there = bendOf({ from: "a", to: "b", strength: 1 });
  const back = bendOf({ from: "b", to: "a", strength: 1 });
  assert.notEqual(there.bow, back.bow);
});

test("a bend is a bow, not a knot", () => {
  for (const pair of [["a", "b"], ["note:long/path.md", "person:Someone"], ["x", "y"]]) {
    const { bow } = bendOf({ from: pair[0]!, to: pair[1]!, strength: 1 });
    assert.ok(Math.abs(bow) >= 0.09 && Math.abs(bow) <= 0.26, `${bow} is not a gentle curve`);
  }
});

test("the middle is drawn at one size, however much it holds", () => {
  assert.equal(radiusOf(0, "core"), CORE);
  assert.equal(radiusOf(80, "core"), CORE, "the middle is not a tally of anything");
});

// A hand held in the air cannot be aimed to the pixel, and an orb is about ten across, so without
// somewhere to miss, the only thing a hand ever catches is the core.
test("a hand may miss an orb and still be taken to have meant it", () => {
  const nodes = [orb("a", 240, -60)];
  const screen = placed(nodes);
  const drawn = new Map([["a", about("a", 3)]]);
  const on = look(nodes[0]!, START, size);
  const past = { x: on.x + 22, y: on.y };

  assert.equal(nodeAt(past, nodes, drawn, screen, START), undefined, "a pointer is aimed");
  assert.equal(nodeAt(past, nodes, drawn, screen, START, () => 1, 34)?.id, "a");
});

test("what is under the point is taken before what is merely within reach", () => {
  const at = (x: number) => {
    const spot = reach({ x, y: 300 }, 0, START, size)!;
    return orb(`n${x}`, spot.x, spot.y);
  };
  const big = at(500);
  const small = at(535);
  const nodes = [big, small];
  const screen = placed(nodes);
  const drawn = new Map([
    [big.id, about(big.id, 400)],
    [small.id, about(small.id, 1)],
  ]);

  // Inside the large orb, but nearer the small one's middle than the large one's.
  const point = { x: 520, y: 300 };
  assert.equal(nodeAt(point, nodes, drawn, screen, START)?.id, big.id);
  assert.equal(nodeAt(point, nodes, drawn, screen, START, () => 1, 60)?.id, big.id);
});

test("reaching for nothing catches nothing", () => {
  const nodes = [orb("a", 240, -60)];
  const screen = placed(nodes);
  const drawn = new Map([["a", about("a", 3)]]);
  assert.equal(nodeAt({ x: 5, y: 5 }, nodes, drawn, screen, START, () => 1, 34), undefined);
});

test("an orb can be drawn to a scale, for when there are too many to draw full size", () => {
  const seen: Seen = { x: 0, y: 0, depth: 0, near: 1 };
  const one = about("a", 4);
  assert.ok(Math.abs(sizeOf(one, seen, START, 1, 0.5) - sizeOf(one, seen, START, 1) / 2) < 1e-9);
});
