import assert from "node:assert/strict";
import { test } from "node:test";
import { held, nameFor, sizeOf } from "./shelf.ts";

test("a size is said the way Finder says it, in thousands", () => {
  assert.equal(sizeOf(1), "1 byte");
  assert.equal(sizeOf(999), "999 bytes");
  assert.equal(sizeOf(1_000), "1 KB");
  assert.equal(sizeOf(12_345), "12 KB");
  assert.equal(sizeOf(1_234_567), "1.2 MB");
  assert.equal(sizeOf(123_456_789), "123 MB");
  assert.equal(sizeOf(4_500_000_000), "4.5 GB");
});

test("a long name loses its middle and keeps its ending, which says what it is", () => {
  assert.equal(nameFor("report.pdf", 20), "report.pdf");
  assert.equal(nameFor("quarterly report for the board.pdf", 20), "quarterly …board.pdf");
  assert.equal(nameFor("quarterly report for the board.pdf", 20).length, 20);
  assert.equal(nameFor("a folder with a very long name", 12), "a fold… name");
});

test("a press becomes a drag out only once it has moved a little, with the button still down", () => {
  const pressed = { x: 10, y: 10 };
  assert.equal(held(pressed, { x: 12, y: 11, buttons: 1 }), false, "a click that wobbles is still a click");
  assert.equal(held(pressed, { x: 16, y: 10, buttons: 1 }), true);
  assert.equal(held(pressed, { x: 16, y: 10, buttons: 0 }), false, "the button let go");
  assert.equal(held(null, { x: 16, y: 10, buttons: 1 }), false, "nothing was pressed on");
});
