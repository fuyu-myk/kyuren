import assert from "node:assert/strict";
import { test } from "node:test";
import { inHandfuls } from "#projects/pool.ts";

test("answers come back in the order they were asked for", async () => {
  const found = await inHandfuls([1, 2, 3, 4, 5], 2, async (one) => {
    await new Promise((ready) => setTimeout(ready, (6 - one) * 4));
    return one * 10;
  });
  assert.deepEqual(found, [10, 20, 30, 40, 50]);
});

test("never more than a handful at once", async () => {
  let running = 0;
  let most = 0;

  await inHandfuls(Array.from({ length: 30 }, (_, at) => at), 4, async () => {
    running += 1;
    most = Math.max(most, running);
    await new Promise((ready) => setTimeout(ready, 2));
    running -= 1;
  });

  assert.equal(most, 4, "a machine asked for thirty things at once stops answering");
});

test("nothing to do is done immediately", async () => {
  assert.deepEqual(await inHandfuls([], 4, async () => 1), []);
});

test("fewer things than hands does not idle", async () => {
  const found = await inHandfuls([1, 2], 8, async (one) => one);
  assert.deepEqual(found, [1, 2]);
});
