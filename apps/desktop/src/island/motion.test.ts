import assert from "node:assert/strict";
import { test } from "node:test";
import { current, grown, moved, settled, still, type Size } from "./motion.ts";

const small: Size = { width: 184, height: 38, radius: 10, ear: 0 };
const large: Size = { width: 640, height: 236, radius: 24, ear: 12 };

function play(from: Size, to: Size, seconds: number): { peak: number; end: ReturnType<typeof still> } {
  let m = still(from);
  let peak = 0;
  for (let t = 0; t < seconds; t += 1 / 60) {
    m = moved(m, to, 1 / 60);
    peak = Math.max(peak, current(m).width);
  }
  return { peak, end: m };
}

test("growing overshoots a little and settles within a second", () => {
  const { peak, end } = play(small, large, 1);
  assert.ok(peak > large.width, "a slight overshoot reads as springing out");
  assert.ok(peak < large.width * 1.06, `but only slight: ${peak.toFixed(1)}`);
  assert.ok(settled(end, large));
});

test("folding does not overshoot, and is quicker", () => {
  let m = still(large);
  let lowest = Infinity;
  let at = 0;
  for (let t = 0; t < 1; t += 1 / 60) {
    m = moved(m, small, 1 / 60);
    lowest = Math.min(lowest, current(m).width);
    if (at === 0 && settled(m, small)) at = t;
  }
  assert.ok(lowest >= small.width - 0.5, `no tucking past the notch: ${lowest.toFixed(1)}`);
  assert.ok(at > 0 && at < 0.6, `folded in ${at.toFixed(2)} s`);
});

test("what is inside waits until the island has grown around it", () => {
  let m = still(small);
  assert.equal(grown(m, large), false);
  let first = -1;
  for (let t = 0; t < 1; t += 1 / 60) {
    m = moved(m, large, 1 / 60);
    if (first < 0 && grown(m, large)) {
      first = t;
      const size = current(m);
      assert.ok(size.width >= large.width * 0.95 && size.height >= large.height * 0.95, `grown at ${size.width.toFixed(0)} by ${size.height.toFixed(0)}`);
    }
  }
  assert.ok(first > 0.15 && first < 0.4, `grown after ${first.toFixed(2)} s`);
});
