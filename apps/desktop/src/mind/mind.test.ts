import assert from "node:assert/strict";
import { test } from "node:test";
import { Mind, MIDDLE, spanOf, type Incoming } from "./mind.ts";
import type { Layer } from "./palette.ts";
import type { Drawn } from "./render.ts";

function node(id: string, layer: Layer, kind: Drawn["kind"] = "note"): Drawn {
  return { id, label: id, layer, kind, weight: 2 };
}

const both: Incoming = {
  nodes: [
    node("entity:Sam", "memory", "entity"),
    node("note:a", "memory"),
    node("note:b", "memory"),
    node("tool:today", "capability", "tool"),
  ],
  links: [
    { from: "note:a", to: "entity:Sam", strength: 1 },
    { from: "note:b", to: "entity:Sam", strength: 1 },
  ],
};

function nearest(mind: Mind): number {
  const shown = mind.visible();
  let closest = Infinity;
  for (let one = 0; one < shown.length; one += 1) {
    for (let two = one + 1; two < shown.length; two += 1) {
      const a = shown[one]!.home;
      const b = shown[two]!.home;
      closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y));
    }
  }
  return closest;
}

test("everything on show is given a place in the whirlpool, around the middle", () => {
  const mind = new Mind();
  mind.accept(both);

  assert.equal(mind.visible().length, 5, "four things it knows, and itself");
  assert.equal(mind.visible()[0]!.id, MIDDLE, "the middle arrives first");

  const middle = mind.node(MIDDLE)!;
  assert.deepEqual(middle.home, { x: 0, y: 0, lift: 0 });
  for (const one of mind.visible()) {
    if (one.id === MIDDLE) continue;
    assert.ok(Math.hypot(one.home.x, one.home.y) > 0, "nothing else belongs on top of it");
  }
});

test("the middle stays whatever is turned off", () => {
  const mind = new Mind();
  mind.accept(both);
  for (const layer of ["memory", "reasoning", "capability"] as const) mind.toggle(layer);

  assert.deepEqual(mind.visible().map((one) => one.id), [MIDDLE]);
});

test("every arm hangs off the middle", () => {
  const mind = new Mind();
  mind.accept(both);

  const spokes = mind.visibleEdges().filter((one) => one.from === MIDDLE);
  assert.ok(spokes.length > 0, "a whirlpool hanging off nothing is a scatter");
  for (const spoke of spokes) {
    const head = mind.describe(spoke.to)!;
    assert.ok(["entity", "tool", "note"].includes(head.kind));
  }

  const heads = new Set(spokes.map((one) => one.to));
  assert.ok(heads.has("entity:Sam"), "what the notes are about is what hangs off the middle");
  assert.ok(heads.has("tool:today"));
  assert.ok(!heads.has("note:a"), "and what hangs off that is not hung off the middle twice");
});

test("dragging the middle brings the arms, and letting go settles them back", () => {
  const mind = new Mind();
  mind.accept(both);
  for (let at = 0; at < 300; at += 1) mind.settle(1 / 60);

  const arm = mind.node("entity:Sam")!;
  const wasAt = { x: arm.x, y: arm.y };

  mind.hold(MIDDLE, 260, 180);
  for (let at = 0; at < 60; at += 1) mind.settle(1 / 60);

  const pulled = Math.hypot(arm.x - wasAt.x, arm.y - wasAt.y);
  assert.ok(pulled > 8, `the arms should come along, not stay put (${pulled})`);
  assert.equal(mind.node(MIDDLE)!.x, 260, "and the middle goes where it is put");

  mind.release(MIDDLE);
  for (let at = 0; at < 600; at += 1) mind.settle(1 / 60);

  const middle = mind.node(MIDDLE)!;
  assert.ok(Math.hypot(middle.x, middle.y) < 12, "it belongs in the middle and returns to it");
  assert.ok(
    Math.hypot(arm.x - arm.home.x, arm.y - arm.home.y) < 90,
    "and the whirlpool settles back into its shape",
  );
});

test("hiding a layer opens out what is left", () => {
  const mind = new Mind();
  mind.accept({
    nodes: [
      ...Array.from({ length: 12 }, (_, at) => node(`note:${at}`, "memory")),
      ...Array.from({ length: 6 }, (_, at) => node(`tool:${at}`, "capability", "tool")),
    ],
    links: [],
  });

  const crowded = nearest(mind);
  mind.toggle("memory");
  assert.ok(nearest(mind) > crowded, "a view with less in it should use the room it just gained");
});

test("a view changes where an orb is going, never where it is", () => {
  const mind = new Mind();
  mind.accept(both);
  mind.settle(1 / 60);

  const before = mind.visible().map((one) => ({ id: one.id, x: one.x, y: one.y }));
  mind.toggle("capability");

  for (const was of before) {
    const now = mind.node(was.id);
    if (!now) continue;
    assert.equal(now.x, was.x, "an orb that jumps on a view change reads as a different mind");
    assert.equal(now.y, was.y);
  }
});

test("showing a layer again brings it back to the arrangement", () => {
  const mind = new Mind();
  mind.accept(both);
  mind.toggle("capability");
  assert.equal(mind.visible().length, 4);

  mind.toggle("capability");
  assert.equal(mind.visible().length, 5);
  const tool = mind.node("tool:today")!;
  assert.ok(Math.hypot(tool.home.x, tool.home.y) > 0);
});

test("only what is new is reported as arriving", () => {
  const mind = new Mind();
  assert.deepEqual(mind.accept(both)[0], MIDDLE);
  assert.equal(mind.accept(both).length, 0, "everything arriving again is the mind restarting");

  const more = { nodes: [...both.nodes, node("note:c", "memory")], links: both.links };
  assert.deepEqual(mind.accept(more), ["note:c"]);
});

test("what is gone is forgotten", () => {
  const mind = new Mind();
  mind.accept(both);
  mind.accept({ nodes: [node("note:a", "memory")], links: [] });

  assert.deepEqual(mind.visible().map((one) => one.id), [MIDDLE, "note:a"]);
  assert.equal(mind.node("entity:Sam"), undefined);
});

test("a link to something no longer there is dropped", () => {
  const mind = new Mind();
  mind.accept(both);
  mind.accept({ nodes: [node("note:a", "memory")], links: both.links });
  assert.deepEqual(
    mind.visibleEdges().filter((one) => one.from !== MIDDLE),
    [],
    "a link to something that has gone is not a link",
  );
});

test("reading something that goes away stops it being read", () => {
  const mind = new Mind();
  mind.accept(both);
  mind.focused = "tool:today";
  mind.toggle("capability");
  assert.equal(mind.focused, undefined);
});

test("a whirlpool is sized to the window it is shown in", () => {
  assert.ok(spanOf({ width: 1600, height: 1000 }) > spanOf({ width: 800, height: 600 }));
  assert.ok(spanOf({ width: 100, height: 60 }) >= 200, "a tiny window must not make a tiny dot");

  const mind = new Mind();
  mind.accept(both);
  const small = mind.visible().map((one) => Math.hypot(one.home.x, one.home.y));
  mind.fill(900);
  const large = mind.visible().map((one) => Math.hypot(one.home.x, one.home.y));
  assert.ok(Math.max(...large) > Math.max(...small));
});

test("holding an orb keeps it where it is put", () => {
  const mind = new Mind();
  mind.accept(both);
  mind.hold("note:a", 120, -80);
  for (let at = 0; at < 120; at += 1) mind.settle(1 / 60);

  const held = mind.node("note:a")!;
  assert.equal(held.x, 120);
  assert.equal(held.y, -80);

  mind.release("note:a");
  for (let at = 0; at < 240; at += 1) mind.settle(1 / 60);
  assert.ok(Math.hypot(held.x - held.home.x, held.y - held.home.y) < 90, "it should swim home");
});

test("summoning it again throws it out from the middle rather than finding it where it was", () => {
  const mind = new Mind();
  mind.accept(both);
  for (let at = 0; at < 300; at += 1) mind.settle(1 / 60);

  const arms = mind.visible().filter((one) => one.id !== MIDDLE);
  assert.ok(Math.min(...arms.map((one) => Math.hypot(one.x, one.y))) > 40, "places found by now");

  mind.rewind();
  for (const one of arms) {
    const out = Math.hypot(one.x, one.y);
    const belongs = Math.hypot(one.home.x, one.home.y);
    assert.ok(out < belongs * 0.2, `${out} is not back in the middle`);
    assert.equal(one.vx, 0, "and it should set off from rest");
  }

  for (let at = 0; at < 300; at += 1) mind.settle(1 / 60);
  for (const one of arms) {
    assert.ok(Math.hypot(one.x - one.home.x, one.y - one.home.y) < 90, "and swim back out");
  }
});

const everything: Incoming = {
  nodes: [
    node("entity:Sam", "memory", "entity"),
    node("entity:Ana", "memory", "entity"),
    node("note:a", "memory"),
    node("note:b", "memory"),
    node("note:loose", "memory"),
    node("tool:today", "capability", "tool"),
    node("tool:remember", "capability", "tool"),
    node("step:1", "reasoning", "step"),
    node("step:2", "reasoning", "step"),
  ],
  links: [
    { from: "note:a", to: "entity:Sam", strength: 1 },
    { from: "note:b", to: "entity:Ana", strength: 1 },
    { from: "step:1", to: "tool:today", strength: 1 },
    { from: "step:2", to: "tool:remember", strength: 1 },
  ],
};

/// Whether every orb on show can be reached from the middle by following threads.
function joined(mind: Mind): string[] {
  const edges = mind.visibleEdges();
  const found = new Set([MIDDLE]);
  for (let pass = 0; pass < edges.length + 1; pass += 1) {
    for (const edge of edges) {
      if (found.has(edge.from)) found.add(edge.to);
      if (found.has(edge.to)) found.add(edge.from);
    }
  }
  return mind.visible().map((one) => one.id).filter((id) => !found.has(id));
}

test("every view hangs off the middle, whichever layers are on", () => {
  for (const off of [
    [], ["memory"], ["reasoning"], ["capability"],
    ["memory", "reasoning"], ["memory", "capability"], ["reasoning", "capability"],
  ] as const) {
    const mind = new Mind();
    mind.accept(everything);
    for (const layer of off) mind.toggle(layer as Layer);

    const adrift = joined(mind);
    assert.deepEqual(adrift, [], `${adrift.join(", ")} float free with ${off.join("+")} off`);
  }
});

const spread: Incoming = {
  nodes: [
    node("entity:Sam", "memory", "entity"),
    node("entity:Aaron", "connected", "entity"),
    node("note:mine", "memory"),
    node("note:theirs", "connected"),
    node("tool:today", "capability", "tool"),
  ],
  links: [
    { from: "entity:Sam", to: "note:mine", strength: 1 },
    { from: "entity:Sam", to: "note:theirs", strength: 1 },
    { from: "entity:Aaron", to: "note:theirs", strength: 1 },
  ],
};

function ids(mind: Mind): string[] {
  return mind.visible().map((one) => one.id).sort();
}

test("one view shows that layer alone, with the people its notes are about", () => {
  const mind = new Mind();
  mind.accept(spread);

  mind.only("connected");
  assert.deepEqual(ids(mind), ["entity:Aaron", "entity:Sam", MIDDLE, "note:theirs"].sort(),
    "Sam is in a note that is shown, so Sam is shown, wherever Sam belongs");
  assert.deepEqual(mind.layers(), ["connected"]);

  mind.only("capability");
  assert.deepEqual(ids(mind), [MIDDLE, "tool:today"].sort());

  mind.only(undefined);
  assert.equal(mind.visible().length, 6, "everything again");
  assert.equal(mind.layers().length, 4);
});

test("someone only in notes from elsewhere is not shown among my own", () => {
  const mind = new Mind();
  mind.accept(spread);
  mind.only("memory");
  assert.deepEqual(ids(mind), ["entity:Sam", MIDDLE, "note:mine"].sort());
});

test("a view says what it put away and what it brought back", () => {
  const mind = new Mind();
  mind.accept(spread);
  const first = mind.only("connected");
  assert.deepEqual(first.left.sort(), ["note:mine", "tool:today"]);
  assert.deepEqual(first.returned, []);

  const back = mind.only(undefined);
  assert.deepEqual(back.left, []);
  assert.deepEqual(back.returned.sort(), ["note:mine", "tool:today"]);
});

test("a whirlpool that has settled stops stepping until something changes", () => {
  const mind = new Mind();
  mind.accept(both);
  assert.equal(mind.resting(), false);
  for (let at = 0; at < 900; at += 1) mind.settle(1 / 60);
  assert.equal(mind.resting(), true, "nothing moves any more, so nothing is stepped");

  mind.hold("note:a", 40, 40);
  assert.equal(mind.resting(), false, "holding something wakes it");
  for (let at = 0; at < 900; at += 1) mind.settle(1 / 60);
  mind.release("note:a");
  assert.equal(mind.resting(), false, "letting go wakes it, since the rest give way");

  for (let at = 0; at < 900; at += 1) mind.settle(1 / 60);
  assert.equal(mind.resting(), true);
  mind.toggle("capability");
  assert.equal(mind.resting(), false, "a view changing wakes it");
});

test("a crowd is given more room and smaller orbs", () => {
  const few = new Mind();
  few.accept(both);
  const wide = new Mind();
  const nodes: Drawn[] = [node("entity:Sam", "memory", "entity")];
  const links: Incoming["links"] = [];
  for (let at = 0; at < 900; at += 1) {
    nodes.push(node(`note:${at}`, "memory"));
    links.push({ from: `note:${at}`, to: "entity:Sam", strength: 1 });
  }
  wide.accept({ nodes, links });

  const small = few.node("note:a")?.size ?? 0;
  const crowded = wide.node("note:1")?.size ?? 0;
  assert.ok(small > 0 && crowded < small * 0.6, `${crowded} is not much smaller than ${small}`);

  const furthest = (mind: Mind) =>
    Math.max(...mind.visible().map((one) => Math.hypot(one.home.x, one.home.y)));
  assert.ok(furthest(wide) > furthest(few) * 1.1, "a crowd spreads further out");
});
