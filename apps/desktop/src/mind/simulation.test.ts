import assert from "node:assert/strict";
import { test } from "node:test";
import { energy, seed, step, SETTLED, type Link, type Node } from "./simulation.ts";
import type { Spot } from "./space.ts";
import { whirl, type Cluster } from "./whirl.ts";

const FRAME = 1 / 60;

function settle(nodes: Node[], links: Link[], frames: number): void {
  for (let at = 0; at < frames; at += 1) step(nodes, links, FRAME);
}

function homes(clusters: Cluster[]): Map<string, Spot> {
  return whirl(clusters, 400);
}

function crowd(count: number): Cluster[] {
  return Array.from({ length: count }, (_, at) => ({ head: `head${at}`, members: [`note${at}`] }));
}

function away(node: Node): number {
  return Math.hypot(node.x - node.home.x, node.y - node.home.y);
}

test("orbs are thrown out from the middle to their places", () => {
  const nodes = seed(homes(crowd(8)));
  const first = nodes[3]!;
  assert.ok(Math.hypot(first.x, first.y) < Math.hypot(first.home.x, first.home.y) * 0.2);

  settle(nodes, [], 240);
  for (const node of nodes) {
    assert.ok(away(node) < 90, `${away(node)} from where it belongs is not settled`);
  }
});

test("the whirlpool comes to rest rather than shivering forever", () => {
  const nodes = seed(homes(crowd(12)));
  settle(nodes, [], 60);
  const early = energy(nodes);
  settle(nodes, [], 400);
  assert.ok(energy(nodes) < early * 0.1, "an arrangement that never settles is never read");
});

test("two orbs on the same spot shove each other apart", () => {
  const home = { x: 200, y: 0, lift: 0 };
  const nodes: Node[] = ["a", "b"].map((id) => ({
    id,
    x: 200,
    y: 0,
    lift: 0,
    vx: 0,
    vy: 0,
    mass: 1,
    size: 12,
    home,
    pinned: false,
  }));

  settle(nodes, [], 120);
  const apart = Math.hypot(nodes[0]!.x - nodes[1]!.x, nodes[0]!.y - nodes[1]!.y);
  assert.ok(apart > SETTLED.padding, `${apart} apart is two orbs sharing a place`);
});

test("an orb rises to the height of its place", () => {
  const nodes = seed(homes(crowd(4)));
  const one = nodes[2]!;
  assert.ok(one.lift < one.home.lift, "it starts below, on its way out from the middle");
  settle(nodes, [], 240);
  assert.ok(Math.abs(one.lift - one.home.lift) < 1);
});

test("what is held still stays where it is put", () => {
  const nodes = seed(homes(crowd(6)));
  const held = nodes[1]!;
  held.pinned = true;
  held.x = 40;
  held.y = -60;

  settle(nodes, [], 180);
  assert.equal(held.x, 40);
  assert.equal(held.y, -60);
});

test("a link holds two orbs at the distance the arrangement gave them", () => {
  const nodes = seed(homes(crowd(5)));
  const links: Link[] = [{ from: "head0", to: "note0", strength: 1 }];
  const from = nodes.find((one) => one.id === "head0")!;
  const to = nodes.find((one) => one.id === "note0")!;
  const rest = Math.hypot(to.home.x - from.home.x, to.home.y - from.home.y);

  settle(nodes, links, 300);
  const apart = Math.hypot(to.x - from.x, to.y - from.y);
  assert.ok(Math.abs(apart - rest) < rest * 0.5 + 40, `${apart} against ${rest} is a link fighting the whirlpool`);
});

test("nothing is thrown across the screen by a frame that took too long", () => {
  const nodes = seed(homes(crowd(10)));
  step(nodes, [], 9);
  for (const node of nodes) {
    assert.ok(Number.isFinite(node.x) && Math.hypot(node.x, node.y) < 4000);
  }
});

test("a thousand orbs still arrange fast enough to be moved through", () => {
  const many: Cluster[] = Array.from({ length: 250 }, (_, at) => ({
    head: `head${at}`,
    members: [`a${at}`, `b${at}`, `c${at}`],
  }));
  const nodes = seed(homes(many));
  const links: Link[] = many.flatMap((cluster) =>
    cluster.members.map((member) => ({ from: cluster.head, to: member, strength: 1 })),
  );
  assert.equal(nodes.length, 1000);

  settle(nodes, links, 30);
  const began = performance.now();
  settle(nodes, links, 60);
  const each = (performance.now() - began) / 60;

  assert.ok(each < 16, `${each.toFixed(2)} ms a step cannot keep up with a moving camera`);
});
