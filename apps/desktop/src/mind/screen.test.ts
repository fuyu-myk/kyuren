import assert from "node:assert/strict";
import { test } from "node:test";
import { Screen } from "./screen.ts";
import { born, type Node } from "./simulation.ts";
import { look, START } from "./space.ts";

const size = { width: 1000, height: 600 };

function orb(id: string, x: number, y: number): Node {
  const node = born(id, { x, y, lift: 0 });
  node.x = x;
  node.y = y;
  return node;
}

test("an orb is placed where it is looked at, and then follows", () => {
  const screen = new Screen();
  const node = orb("a", 300, -120);
  screen.place([node], START, size, 1 / 60);

  const looked = look(node, START, size);
  const at = screen.at("a")!;
  assert.ok(Math.abs(at.x - looked.x) < 1e-9, "the first sight of an orb is not a chase");
  assert.equal(at.depth, looked.depth);
});

test("an orb that is gone is not still on screen", () => {
  const screen = new Screen();
  screen.place([orb("a", 300, 0), orb("b", -300, 0)], START, size, 1 / 60);
  assert.ok(screen.at("b"));

  screen.place([orb("a", 300, 0)], START, size, 1 / 60);
  assert.equal(screen.at("b"), undefined);
  assert.equal(screen.every().length, 1);
});

test("forgetting means the next sight is not swept in from the last one", () => {
  const screen = new Screen();
  const node = orb("a", 300, -120);
  screen.place([node], START, size, 1 / 60);

  node.x = -400;
  node.y = 260;
  screen.forget();
  screen.place([node], START, size, 1 / 60);

  const looked = look(node, START, size);
  assert.ok(Math.abs(screen.at("a")!.x - looked.x) < 1e-9);
});
