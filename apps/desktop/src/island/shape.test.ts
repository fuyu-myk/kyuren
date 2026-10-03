import assert from "node:assert/strict";
import { test } from "node:test";
import { footprint, outlineAt, outlinePath } from "./shape.ts";

test("the island is centred in its panel, flush with the top", () => {
  const o = outlineAt(720, 300, 38, 14, 10);
  assert.equal(o.x, 210);
  assert.deepEqual(footprint(o), { x: 200, y: 0, width: 320, height: 38 });
});

test("the outline runs from the top of one ear, round the bottom corners, to the top of the other", () => {
  const path = outlinePath(outlineAt(720, 300, 100, 14, 10), false);
  assert.ok(path.startsWith("M 200 0 A 10 10 0 0 1 210 10"), path);
  assert.ok(path.includes("A 14 14 0 0 0 224 100"), "bottom left corner");
  assert.ok(path.includes("A 14 14 0 0 0 510 86"), "bottom right corner");
  assert.ok(path.endsWith("A 10 10 0 0 1 520 0"), "the right ear ends on the screen's edge");
  assert.ok(outlinePath(outlineAt(720, 300, 100, 14, 10), true).endsWith(" Z"), "closed along the top for the fill");
});

test("corners never exceed what the island can hold, so a thin island stays a shape", () => {
  const path = outlinePath(outlineAt(720, 200, 12, 30, 10), false);
  assert.ok(path.includes("A 12 12 0 0 0"), "the radius is held to the height");
  assert.ok(path.startsWith("M 260 0 L 260 0"), "no room left for the ears");
});
