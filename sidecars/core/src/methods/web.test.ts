import assert from "node:assert/strict";
import { test } from "node:test";
import { sharedReader } from "#connect/web/reader.ts";
import { webHandlers } from "#methods/web.ts";

test("where a page ended up comes back with what it said, so it can be checked", async () => {
  const sent: Array<{ data: { id: string } }> = [];
  const transport = { send: (message: unknown) => void sent.push(message as { data: { id: string } }), listen: () => undefined };
  const handlers = webHandlers(transport);
  const reading = sharedReader(transport).read("https://example.com/redirects", "page");
  const id = sent[0]?.data.id ?? "";
  await handlers["web.read.answer"]({ id, ok: true, url: "http://192.168.1.1/admin", title: "Router", text: "admin" });
  assert.equal((await reading).url, "http://192.168.1.1/admin");
});
