import assert from "node:assert/strict";
import { test } from "node:test";
import { HELD, onto, Reaching, RELEASE, type Reading } from "./reach.ts";
import { nodeAt, type Drawn } from "./render.ts";
import { Screen } from "./screen.ts";
import { born } from "./simulation.ts";
import { reach, START } from "./space.ts";

function seen(grip: Reading["grip"], x = 0.5, y = 0.5, pinch?: number): Reading {
  return {
    x,
    y,
    hand: Array.from({ length: 42 }, (_, at) => (at % 2 === 0 ? x : y)),
    grip,
    pinch: pinch ?? (grip === "pinch" ? 1 : 0),
  };
}

/// Letting go takes a few readings on purpose, so a test that means to let go says so once.
function release(reaching: Reaching, grip: Reading["grip"], x = 0.5, y = 0.5) {
  let last = reaching.saw(seen(grip, x, y));
  for (let at = 1; at < RELEASE; at += 1) last = reaching.saw(seen(grip, x, y));
  return last;
}

test("a pinch takes hold where the hand is aiming, and holds until the hand opens", () => {
  const reaching = new Reaching();
  assert.equal(reaching.saw(seen("open")).act, "idle");
  assert.deepEqual(reaching.saw(seen("pinch")), { act: "grab", at: { x: 0.5, y: 0.5 } });
  assert.deepEqual(reaching.saw(seen("pinch", 0.6)), { act: "move", at: { x: 0.6, y: 0.5 } });
  assert.deepEqual(release(reaching, "open", 0.6), { act: "drop" });
});

test("a hand that goes while it is holding something lets go of it", () => {
  const reaching = new Reaching();
  reaching.saw(seen("pinch"));
  assert.deepEqual(reaching.saw(undefined), { act: "drop" });
  assert.deepEqual(reaching.saw(undefined), { act: "idle" });
});

// A fist is easy to make by accident while moving a hand about, and changing what the graph shows
// is not something anyone wants to do by accident.
test("a fist must be held before it asks for the next layer, and then asks once", () => {
  const reaching = new Reaching();
  reaching.saw(seen("open"));
  for (let at = 0; at < HELD - 1; at += 1) {
    assert.equal(reaching.saw(seen("fist")).act, "idle", `closed for ${at + 1} is not yet asking`);
  }
  assert.deepEqual(reaching.saw(seen("fist")), { act: "layer" });
  for (let at = 0; at < 20; at += 1) {
    assert.equal(reaching.saw(seen("fist")).act, "idle", "a held fist is one request");
  }
});

test("a fist let go of and made again asks again", () => {
  const reaching = new Reaching();
  const close = () => {
    let asked = false;
    for (let at = 0; at < HELD; at += 1) {
      if (reaching.saw(seen("fist")).act === "layer") asked = true;
    }
    return asked;
  };
  assert.equal(close(), true);
  reaching.saw(seen("open"));
  assert.equal(close(), true);
});

test("a hand that is only passing through a fist asks for nothing", () => {
  const reaching = new Reaching();
  reaching.saw(seen("open"));
  for (let at = 0; at < HELD - 1; at += 1) reaching.saw(seen("fist"));
  reaching.saw(seen("open"));
  for (let at = 0; at < HELD - 1; at += 1) {
    assert.equal(reaching.saw(seen("fist")).act, "idle", "the count starts again");
  }
});

test("a finger held out asks what it is pointing at", () => {
  const reaching = new Reaching();
  assert.deepEqual(reaching.saw(seen("point", 0.3, 0.4)), { act: "read", at: { x: 0.3, y: 0.4 } });
  assert.deepEqual(reaching.saw(seen("point", 0.35, 0.4)), { act: "read", at: { x: 0.35, y: 0.4 } });
});

test("pointing while holding something lets go of it first", () => {
  const reaching = new Reaching();
  reaching.saw(seen("pinch"));
  assert.deepEqual(release(reaching, "point"), { act: "drop" });
  assert.equal(reaching.saw(seen("point")).act, "read");
});

// Letting go of a node by curling the hand is the same gesture as switching layer, and doing both
// would drop the node into a view it no longer belongs to.
test("letting go of a node does not also switch layer", () => {
  const reaching = new Reaching();
  reaching.saw(seen("pinch"));
  assert.deepEqual(release(reaching, "fist"), { act: "drop" });
  for (let at = 0; at < HELD - 1; at += 1) {
    assert.equal(reaching.saw(seen("fist")).act, "idle");
  }
});

test("the aim is wherever the hand was last seen aiming, and goes when the hand does", () => {
  const reaching = new Reaching();
  reaching.saw(seen("open", 0.4, 0.4));
  assert.deepEqual(reaching.aim, { x: 0.4, y: 0.4 });
  reaching.saw(seen("pinch", 0.44, 0.5));
  assert.deepEqual(reaching.aim, { x: 0.44, y: 0.5 });
  reaching.saw(undefined);
  assert.equal(reaching.aim, undefined);
});

// Holding a pinch while moving a hand is not perfectly steady. Dropping on the first doubtful
// reading leaves the node behind mid drag, which feels like not being able to drag at all.
test("a node is carried through a doubtful reading rather than dropped", () => {
  const reaching = new Reaching();
  reaching.saw(seen("pinch", 0.3, 0.3));

  const wobbled = reaching.saw(seen("unsure", 0.4, 0.3, 0.9));
  assert.deepEqual(wobbled, { act: "move", at: { x: 0.4, y: 0.3 } });
  assert.deepEqual(reaching.saw(seen("pinch", 0.5, 0.3)), { act: "move", at: { x: 0.5, y: 0.3 } });
});

test("an opened hand still lets go, just not on the first reading", () => {
  const reaching = new Reaching();
  reaching.saw(seen("pinch", 0.3, 0.3));
  for (let at = 0; at < RELEASE - 1; at += 1) {
    assert.equal(reaching.saw(seen("open", 0.3, 0.3)).act, "move");
  }
  assert.deepEqual(reaching.saw(seen("open", 0.3, 0.3)), { act: "drop" });
  assert.equal(reaching.held, false);
});

// A hand opening slowly passes through the threshold, and the tracker may call one reading in
// the middle of that a pinch. That reading must cost one step of the release, not all of them.
test("a stray pinch reading while letting go delays the release rather than restarting it", () => {
  const reaching = new Reaching();
  reaching.saw(seen("pinch", 0.3, 0.3));
  reaching.saw(seen("open", 0.3, 0.3));
  reaching.saw(seen("open", 0.3, 0.3));
  assert.equal(reaching.saw(seen("pinch", 0.3, 0.3)).act, "move");
  assert.equal(reaching.saw(seen("open", 0.3, 0.3)).act, "move");
  assert.equal(reaching.saw(seen("open", 0.3, 0.3)).act, "move");
  assert.deepEqual(reaching.saw(seen("open", 0.3, 0.3)), { act: "drop" });
});

test("a steady hold is not worn down by the odd doubtful reading", () => {
  const reaching = new Reaching();
  reaching.saw(seen("pinch", 0.3, 0.3));
  for (let at = 0; at < 30; at += 1) {
    reaching.saw(seen("unsure", 0.3, 0.3, 0.9));
    assert.equal(reaching.saw(seen("pinch", 0.3, 0.3)).act, "move");
    assert.equal(reaching.saw(seen("pinch", 0.3, 0.3)).act, "move");
  }
  assert.equal(reaching.held, true);
});

test("the middle of what the camera sees is the middle of the window", () => {
  assert.deepEqual(onto({ x: 0.5, y: 0.5 }, { width: 1000, height: 600 }), { x: 500, y: 300 });
});

test("a hand short of the edge of the frame still reaches the edge of the window", () => {
  assert.equal(onto({ x: 0.85, y: 0.5 }, { width: 1000, height: 600 }).x, 1000);
  assert.equal(onto({ x: 0.15, y: 0.5 }, { width: 1000, height: 600 }).x, 0);
});

// The one thing vision mode has to get right: a pinch in the air takes hold of the orb it is
// aimed at, and moving the hand moves that orb. Everything above the camera is exercised here,
// in the order the window does it.
test("a pinch aimed at an orb takes hold of it, and the hand carries it", () => {
  const size = { width: 1000, height: 600 };
  const aiming = { x: 0.62, y: 0.42 };
  const spot = reach(onto(aiming, size), 0, START, size)!;

  const one = born("a", { x: spot.x, y: spot.y, lift: 0 });
  one.x = spot.x;
  one.y = spot.y;
  const other = born("b", { x: -420, y: 260, lift: 0 });
  other.x = -420;
  other.y = 260;

  const nodes = [one, other];
  const screen = new Screen();
  screen.place(nodes, START, size, 1);
  const drawn = new Map([
    ["a", { id: "a", label: "a", layer: "memory", kind: "note", weight: 3 } as Drawn],
    ["b", { id: "b", label: "b", layer: "memory", kind: "note", weight: 3 } as Drawn],
  ]);

  const reaching = new Reaching();
  const grab = reaching.saw(seen("pinch", aiming.x, aiming.y));
  assert.equal(grab.act, "grab");
  assert.equal(nodeAt(onto(grab.act === "grab" ? grab.at : aiming, size), nodes, drawn, screen, START)?.id, "a");

  const moved = reaching.saw(seen("pinch", 0.72, 0.42));
  assert.equal(moved.act, "move");
  const to = reach(onto(moved.act === "move" ? moved.at : aiming, size), 0, START, size)!;
  assert.ok(to.x > spot.x, "the orb is carried the way the hand went");
});
