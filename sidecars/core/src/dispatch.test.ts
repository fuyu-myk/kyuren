import assert from "node:assert/strict";
import { test } from "node:test";
import { createDispatcher } from "#dispatch.ts";
import type { Outbound } from "#protocol.ts";
import type { Transport } from "#transport.ts";

function collector(): { sent: Outbound[]; transport: Transport } {
  const sent: Outbound[] = [];
  return {
    sent,
    transport: {
      send: (message) => void sent.push(message),
      listen: () => {},
    },
  };
}

test("a known method answers with its result", async () => {
  const { sent, transport } = collector();
  const dispatcher = createDispatcher(transport);
  dispatcher.register("echo", (params) => params);

  await dispatcher.handle(JSON.stringify({ id: "a", method: "echo", params: { n: 1 } }));

  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], { id: "a", ok: true, result: { n: 1 } });
});

test("an unknown method answers rather than hanging", async () => {
  const { sent, transport } = collector();
  const dispatcher = createDispatcher(transport);

  await dispatcher.handle(JSON.stringify({ id: "b", method: "absent" }));

  assert.deepEqual(sent, [
    { id: "b", ok: false, error: { code: "method_not_found", message: "no handler for absent" } },
  ]);
});

test("a handler that throws produces an error response, not silence", async () => {
  const { sent, transport } = collector();
  const dispatcher = createDispatcher(transport);
  dispatcher.register("boom", () => {
    throw new Error("detonated");
  });

  await dispatcher.handle(JSON.stringify({ id: "c", method: "boom" }));

  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], {
    id: "c",
    ok: false,
    error: { code: "internal", message: "detonated" },
  });
});

test("a malformed line carrying no id emits an event and is discarded", async () => {
  const { sent, transport } = collector();
  const dispatcher = createDispatcher(transport);

  await dispatcher.handle("this is not json");

  assert.equal(sent.length, 1);
  assert.equal((sent[0] as { event: string }).event, "sidecar.malformed");
});

test("a malformed request carrying an id answers on that id", async () => {
  const { sent, transport } = collector();
  const dispatcher = createDispatcher(transport);

  await dispatcher.handle(JSON.stringify({ id: "d", method: "echo", params: 7 }));

  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], {
    id: "d",
    ok: false,
    error: { code: "invalid_params", message: "params is not an object" },
  });
});

test("responses correlate by id when handlers finish out of order", async () => {
  const { sent, transport } = collector();
  const dispatcher = createDispatcher(transport);
  dispatcher.register("slow", () => new Promise((resolve) => setTimeout(() => resolve("slow"), 20)));
  dispatcher.register("fast", () => "fast");

  const first = dispatcher.handle(JSON.stringify({ id: "slow-1", method: "slow" }));
  const second = dispatcher.handle(JSON.stringify({ id: "fast-1", method: "fast" }));
  await Promise.all([first, second]);

  assert.deepEqual(
    sent.map((message) => (message as { id: string }).id),
    ["fast-1", "slow-1"],
  );
});
