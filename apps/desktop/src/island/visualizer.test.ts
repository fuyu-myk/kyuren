import assert from "node:assert/strict";
import { test } from "node:test";
import { FALLBACK, follow, paletteOf, settled, struck } from "./visualizer.ts";

test("bars rise quickly to what is heard and fall back slowly", () => {
  const up = follow([0], [1], 16, 35, 160)[0]!;
  const down = 1 - follow([1], [0], 16, 35, 160)[0]!;
  assert.ok(up > 0.3, `rose only ${up}`);
  assert.ok(down < up / 2, `fell ${down} against a rise of ${up}`);
  assert.deepEqual(follow([0.4, 0.7], [0.4, 0.7], 16, 35, 160), [0.4, 0.7], "what is already there stays");
});

test("a long pause between frames lands on what is heard rather than past it", () => {
  const [after] = follow([0], [0.8], 5_000, 35, 160);
  assert.ok(after! <= 0.8 && after! > 0.79);
});

test("a hit lifts the bars, the louder ones the most, and never past full", () => {
  assert.equal(struck(0.5, 0), 0.5, "with no hit a bar stands as heard");
  assert.ok(struck(0.5, 1) > 0.6, `lifted only to ${struck(0.5, 1)}`);
  assert.ok(struck(0.6, 1) - 0.6 > struck(0.1, 1) - 0.1);
  assert.equal(struck(0.9, 1), 1);
});

test("drawing stops once everything has come to rest", () => {
  assert.ok(settled([0.001, 0, 0.002]));
  assert.ok(!settled([0.001, 0.2]));
});

/// A cover of one colour on its left half and another on its right, as a canvas reads it.
function cover(left: [number, number, number], right: [number, number, number], size = 8): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b] = x < size / 2 ? left : right;
      pixels.set([r, g, b, 255], (y * size + x) * 4);
    }
  }
  return pixels;
}

function hsl(css: string): { h: number; s: number; l: number } {
  const match = /hsl\((\d+(?:\.\d+)?) (\d+(?:\.\d+)?)% (\d+(?:\.\d+)?)%\)/.exec(css);
  assert.ok(match, `${css} is not an hsl colour`);
  return { h: Number(match[1]), s: Number(match[2]) / 100, l: Number(match[3]) / 100 };
}

test("the bars take the cover's colours, left from its left and right from its right", () => {
  const [left, right] = paletteOf(cover([200, 30, 40], [30, 60, 210]), 8, 8);
  const red = hsl(left);
  const blue = hsl(right);
  assert.ok(red.h < 10 || red.h > 350, `left hue ${red.h}`);
  assert.ok(blue.h > 215 && blue.h < 240, `right hue ${blue.h}`);
});

test("a dark cover is lifted so its bars still show against the island", () => {
  const [left] = paletteOf(cover([10, 20, 70], [10, 20, 70]), 8, 8);
  const lifted = hsl(left);
  assert.ok(lifted.l >= 0.62, `lightness ${lifted.l}`);
  assert.ok(lifted.s >= 0.5, `saturation ${lifted.s}`);
});

test("a grey cover, with no colour to take, keeps the island's own", () => {
  assert.deepEqual(paletteOf(cover([90, 90, 90], [200, 200, 200]), 8, 8), FALLBACK);
});
