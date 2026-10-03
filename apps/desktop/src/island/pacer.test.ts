import assert from "node:assert/strict";
import { test } from "node:test";
import { pacer } from "./pacer.ts";

const settle = () => new Promise((done) => setImmediate(done));

test("one value is sent at a time; one arriving meanwhile waits, replaced by any after it, and the last always goes", async () => {
  const sent: number[] = [];
  const finish: Array<() => void> = [];
  const send = pacer<number>((value) => {
    sent.push(value);
    return new Promise<void>((done) => finish.push(done));
  });
  send(1);
  send(2);
  send(3);
  assert.deepEqual(sent, [1], "the others wait for it");
  finish.shift()?.();
  await settle();
  assert.deepEqual(sent, [1, 3], "only the latest of those waiting");
  finish.shift()?.();
  await settle();
  assert.deepEqual(sent, [1, 3], "nothing is left to send");
  send(4);
  assert.deepEqual(sent, [1, 3, 4], "with nothing being sent, at once");
});

test("a send that failed does not hold up the ones after it", async () => {
  const sent: number[] = [];
  const send = pacer<number>((value) => {
    sent.push(value);
    return value === 1 ? Promise.reject(new Error("refused")) : Promise.resolve();
  });
  send(1);
  send(2);
  await settle();
  assert.deepEqual(sent, [1, 2]);
});
