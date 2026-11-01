import assert from "node:assert/strict";
import { test } from "node:test";
import { BANDS, bellAt, bellsOf, FALLBACK, follow, followBells, paletteOf, REGIONS, settled } from "./visualizer.ts";

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

test("each bell stands over where its part of the music is loudest, as tall as that part", () => {
  const levels = new Array<number>(BANDS).fill(0.1);
  levels[3] = 0.9;
  levels[14] = 0.6;
  levels[15] = 0.6;
  const [bass, low, high] = bellsOf(levels);
  assert.ok(Math.abs(bass!.centre - 3) < 0.6, `bass centred at ${bass!.centre}`);
  assert.equal(bass!.height, 0.9);
  assert.ok(Math.abs(high!.centre - 14.5) < 0.6, `high mids centred at ${high!.centre}`);
  assert.equal(low!.height, 0.1, "a part with nothing standing out stays low");
});

test("each bell keeps to its own part of the spectrum, and silence lays them all flat", () => {
  const loudAtTheEdges = new Array<number>(BANDS).fill(0).map((_, index) => (index === 0 || index === BANDS - 1 ? 1 : 0));
  bellsOf(loudAtTheEdges).forEach((bell, index) => {
    const [from, to] = REGIONS[index]!;
    assert.ok(bell.centre >= from && bell.centre <= to, `bell ${index} at ${bell.centre} left ${from} to ${to}`);
  });
  for (const bell of bellsOf(new Array<number>(BANDS).fill(0))) assert.equal(bell.height, 0);
});

test("a bell peaks at its centre and falls away evenly either side to nothing", () => {
  const bell = { centre: 10, height: 0.8, width: 1.5 };
  assert.equal(bellAt(bell, 10), 0.8);
  assert.equal(bellAt(bell, 8), bellAt(bell, 12));
  assert.ok(bellAt(bell, 11) < 0.8 && bellAt(bell, 11) > bellAt(bell, 12));
  assert.ok(bellAt(bell, 10 + 4 * 1.5) < 0.001);
});

test("a bell glides to its new place over a few frames rather than jumping there", () => {
  const from = [{ centre: 2, height: 0.2, width: 1.5 }];
  const to = [{ centre: 4, height: 0.9, width: 2 }];
  const [next] = followBells(from, to, 16);
  assert.ok(next!.centre > 2 && next!.centre < 3, `moved to ${next!.centre}`);
  assert.ok(next!.height > 0.2 && next!.height < 0.9);
  const [later] = followBells(from, to, 2_000);
  assert.ok(Math.abs(later!.centre - 4) < 0.01 && Math.abs(later!.height - 0.9) < 0.01);
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
