import assert from "node:assert/strict";
import { test } from "node:test";
import { createReader } from "#connect/web/reader.ts";
import type { Outbound } from "#protocol.ts";
import type { Transport } from "#transport.ts";

function transport(): { sent: Outbound[]; transport: Transport } {
  const sent: Outbound[] = [];
  return { sent, transport: { send: (message: Outbound) => void sent.push(message) } as unknown as Transport };
}

test("a read is asked of the host and resolved by its answer", async () => {
  const { sent, transport: t } = transport();
  const reader = createReader(t);
  const reading = reader.read("https://example.com/a", "page");
  const asked = sent[0] as { event: string; data: { id: string; url: string; kind: string } };
  assert.equal(asked.event, "web.read.request");
  assert.equal(asked.data.url, "https://example.com/a");
  assert.equal(reader.pending(), 1);
  assert.equal(reader.answer(asked.data.id, { ok: true, title: "A", text: "hello" }), true);
  assert.deepEqual(await reading, { ok: true, title: "A", text: "hello" });
  assert.equal(reader.pending(), 0);
});

test("an answer to nothing in particular is refused", () => {
  const reader = createReader(transport().transport);
  assert.equal(reader.answer("nobody", { ok: true }), false);
});

test("a read of a PDF can ask to start at a later page, and a page read asks nothing of the kind", () => {
  const { sent, transport: t } = transport();
  const reader = createReader(t);
  void reader.read("https://arxiv.org/pdf/2508.10875", "page", 7);
  void reader.read("https://example.com/a", "page");
  const [later, plain] = sent as Array<{ data: Record<string, unknown> }>;
  assert.equal(later!.data.from, 7);
  assert.equal("from" in plain!.data, false);
});
