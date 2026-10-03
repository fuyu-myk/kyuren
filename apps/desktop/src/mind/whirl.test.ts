import assert from "node:assert/strict";
import { test } from "node:test";
import type { Spot } from "./space.ts";
import { armsFor, whirl, type Cluster } from "./whirl.ts";

const SPAN = 400;

function crowd(count: number): Cluster[] {
  return Array.from({ length: count }, (_, at) => ({
    head: `head${at}`,
    members: [`note${at}a`, `note${at}b`],
  }));
}

function places(clusters: Cluster[]): Spot[] {
  return [...whirl(clusters, SPAN).values()];
}

function closest(spots: Spot[]): number {
  let nearest = Infinity;
  for (let one = 0; one < spots.length; one += 1) {
    for (let two = one + 1; two < spots.length; two += 1) {
      const a = spots[one]!;
      const b = spots[two]!;
      nearest = Math.min(nearest, Math.hypot(a.x - b.x, a.y - b.y, a.lift - b.lift));
    }
  }
  return nearest;
}

test("everything is given a place, and none of it beyond the rim", () => {
  const clusters = crowd(9);
  const spots = whirl(clusters, SPAN);

  assert.equal(spots.size, 9 * 3);
  for (const spot of spots.values()) {
    assert.ok(Math.hypot(spot.x, spot.y) <= SPAN + 1e-9, "an orb outside the whirlpool is lost");
    assert.ok(Math.hypot(spot.x, spot.y) > 0, "nothing sits on top of the middle");
  }
});

test("fewer orbs are spaced further apart", () => {
  const many = closest(places(crowd(20)));
  const few = closest(places(crowd(4)));
  assert.ok(few > many, "a view with less in it should open out, not keep the same gaps");
});

test("an arm sweeps round as it goes out", () => {
  const spots = [...whirl(crowd(12), SPAN).entries()]
    .map(([id, spot]) => ({ id, out: Math.hypot(spot.x, spot.y), angle: Math.atan2(spot.y, spot.x) }))
    .sort((one, two) => one.out - two.out);

  const inner = spots.slice(0, 4);
  const outer = spots.slice(-4);
  const swept = outer.some((one) => inner.some((two) => Math.abs(one.angle - two.angle) > 0.2));
  assert.ok(swept, "a whirlpool that does not turn is a wheel");
});

test("the rim stands above the middle", () => {
  const spots = [...whirl(crowd(12), SPAN).values()].sort(
    (one, two) => Math.hypot(one.x, one.y) - Math.hypot(two.x, two.y),
  );
  assert.ok(spots.at(-1)!.lift > spots[0]!.lift, "a flat whirlpool has no funnel to it");
});

test("what belongs together is laid out together", () => {
  const spots = whirl(crowd(6), SPAN);
  for (let at = 0; at < 6; at += 1) {
    const head = spots.get(`head${at}`)!;
    const member = spots.get(`note${at}a`)!;
    const away = Math.hypot(head.x - member.x, head.y - member.y, head.lift - member.lift);
    assert.ok(away < SPAN * 0.7, `${away} apart is not together`);
  }
});

test("the arms are dealt evenly", () => {
  const spots = whirl(crowd(12), SPAN);
  const angles = [...spots.values()].map((spot) => Math.atan2(spot.y, spot.x));
  const quarters = new Set(angles.map((angle) => Math.floor(((angle + Math.PI * 4) % (Math.PI * 2)) / (Math.PI / 2))));
  assert.ok(quarters.size >= 3, "a whirlpool bunched on one side is a comma");
});

test("the same mind is laid out the same way twice", () => {
  assert.deepEqual(places(crowd(7)), places(crowd(7)));
});

test("a bigger mind grows more arms, up to a point", () => {
  assert.equal(armsFor(6), 3, "one orb an arm is a handful of threads, not a whirlpool");
  assert.ok(armsFor(200) > armsFor(30));
  assert.ok(armsFor(5000) <= 5, "past a few arms it is a wheel with spokes");
});

test("a clearing is left around whatever sits in the middle", () => {
  const middle = 30;
  for (const span of [SPAN, 900, 220]) {
    for (const spot of whirl(crowd(3), span, middle).values()) {
      const away = Math.hypot(spot.x, spot.y);
      assert.ok(away >= middle * 4, `${away} from a middle of ${middle} leaves no room for a thread`);
    }
  }
});

test("a whirlpool with room to spare does not huddle against the middle", () => {
  const close = Math.min(...[...whirl(crowd(4), 900, 30).values()].map((one) => Math.hypot(one.x, one.y)));
  assert.ok(close > 900 * 0.4, "the clearing is a floor, not the arrangement");
});

test("in a crowd the arms are wider, and everything still fits", () => {
  const clusters: Cluster[] = Array.from({ length: 120 }, (_, at) => ({
    head: `h${at}`,
    members: [`m${at}a`, `m${at}b`, `m${at}c`],
  }));
  const calm = whirl(clusters, 400, 20, 0);
  const crowded = whirl(clusters, 400, 20, 1);
  let moved = 0;
  for (const [id, spot] of calm) {
    const other = crowded.get(id)!;
    moved += Math.abs(Math.hypot(other.x, other.y) - Math.hypot(spot.x, spot.y));
    assert.ok(Math.hypot(other.x, other.y) <= 400 + 1e-9, "nothing is thrown out past the rim");
  }
  assert.ok(moved / calm.size > 5, "orbs stray further from the line of their arm");
});
