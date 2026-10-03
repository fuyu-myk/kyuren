import assert from "node:assert/strict";
import { test } from "node:test";
import { LAYERS } from "./palette.ts";
import { nextView } from "./views.ts";

test("a fist walks the views in order and comes back round to everything", () => {
  const walked: Array<string | undefined> = [];
  let shown: readonly string[] = LAYERS;
  for (let at = 0; at < 5; at += 1) {
    const next = nextView([...shown] as typeof LAYERS[number][]);
    walked.push(next);
    shown = next === undefined ? LAYERS : [next];
  }
  assert.deepEqual(walked, ["memory", "reasoning", "capability", "connected", undefined]);
});

test("from a mix of layers the next view is everything", () => {
  assert.equal(nextView(["memory", "capability"]), undefined);
  assert.equal(nextView([]), undefined, "nothing on show is not a view either");
});
