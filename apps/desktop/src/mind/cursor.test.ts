import assert from "node:assert/strict";
import { test } from "node:test";
import { drawHand, JOINTS } from "./cursor.ts";
import type { Point } from "./space.ts";

type Mark =
  | { kind: "dot"; x: number; y: number; radius: number; ink: string }
  | { kind: "line"; from: [number, number]; to: [number, number]; ink: string };

function recorder() {
  const marks: Mark[] = [];
  let pending: Mark | undefined;
  let from: [number, number] = [0, 0];
  const paint = {
    globalCompositeOperation: "",
    fillStyle: "" as string | object,
    strokeStyle: "",
    lineWidth: 0,
    save() {},
    restore() {},
    beginPath() {},
    moveTo(x: number, y: number) {
      from = [x, y];
    },
    lineTo(x: number, y: number) {
      pending = { kind: "line", from, to: [x, y], ink: "" };
    },
    arc(x: number, y: number, radius: number) {
      pending = { kind: "dot", x, y, radius, ink: "" };
    },
    fill() {
      if (pending?.kind === "dot" && typeof paint.fillStyle === "string") {
        marks.push({ ...pending, ink: paint.fillStyle });
      }
    },
    stroke() {
      if (pending?.kind === "line") marks.push({ ...pending, ink: paint.strokeStyle });
    },
    createRadialGradient() {
      return { addColorStop() {} };
    },
  };
  return { paint: paint as unknown as CanvasRenderingContext2D, marks };
}

const alpha = (of: string) => Number(of.slice(of.lastIndexOf(",") + 1, -1));

/// A hand laid out on a line, with the thumb tip and index tip somewhere recognisable.
function hand(): Point[] {
  const points = Array.from({ length: JOINTS }, (_, which) => ({ x: 10 * which, y: 300 }));
  points[4] = { x: 100, y: 200 };
  points[8] = { x: 140, y: 180 };
  return points;
}

function drawn(pinch: number, shown = 1, of: Point[] = hand()) {
  const { paint, marks } = recorder();
  drawHand(paint, of, pinch, shown);
  const dots = marks.filter((one): one is Extract<Mark, { kind: "dot" }> => one.kind === "dot");
  const lines = marks.filter((one): one is Extract<Mark, { kind: "line" }> => one.kind === "line");
  return { dots, lines };
}

test("every joint is drawn, and every bone between them", () => {
  const { dots, lines } = drawn(0);
  assert.equal(dots.length, JOINTS);
  assert.equal(lines.length, 21, "twenty one bones and nothing else");
  assert.ok(lines.some((one) => one.from[0] === 0 && one.to[0] === 10), "wrist to thumb base");
});

test("the two tips are drawn where the fingers are, larger than the rest", () => {
  const { dots } = drawn(0);
  const thumb = dots.find((one) => one.x === 100 && one.y === 200)!;
  const other = dots.find((one) => one.x === 10)!;
  assert.ok(thumb.radius > other.radius);
  assert.ok(dots.some((one) => one.x === 140 && one.y === 180));
});

test("the tips grow and brighten as they meet", () => {
  const apart = drawn(0).dots.find((one) => one.x === 100 && one.y === 200)!;
  const met = drawn(1).dots.find((one) => one.x === 100 && one.y === 200)!;
  assert.ok(met.radius > apart.radius);
  assert.ok(alpha(met.ink) > alpha(apart.ink));
});

// The hand is drawn over a whirlpool that is still arriving or already leaving, and a hand that
// stayed solid through the closing animation would be the last thing left on a bare screen.
test("the hand fades with everything else, and is gone when the graph is", () => {
  const bright = drawn(1, 1).dots.find((one) => one.x === 100 && one.y === 200)!;
  const dim = drawn(1, 0.4).dots.find((one) => one.x === 100 && one.y === 200)!;
  assert.ok(alpha(dim.ink) < alpha(bright.ink));
  assert.equal(drawn(1, 0).dots.length + drawn(1, 0).lines.length, 0);
});

test("a hand with joints missing is not drawn at all", () => {
  const partial = drawn(0, 1, hand().slice(0, 12));
  assert.equal(partial.dots.length + partial.lines.length, 0);
});
