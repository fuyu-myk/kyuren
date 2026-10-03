import assert from "node:assert/strict";
import { test } from "node:test";
import { webFetchTool, webSearchTool } from "#agent/web.ts";
import { sharedReader, type Read, type Reader } from "#connect/web/reader.ts";

const PUBLIC = async () => ["93.184.216.34"];

test("the reader is never sent to this machine or its network, nor handed a name and password", async () => {
  const fetch = webFetchTool();
  const signal = new AbortController().signal;
  const refusals: Array<[string, RegExp]> = [
    ["http://localhost:11434/api/tags", /this machine or its network/],
    ["http://192.168.1.1/admin", /this machine or its network/],
    ["http://[::1]:8080/", /this machine or its network/],
    ["https://user:secret@example.com/", /name and password/],
    ["file:///etc/passwd", /only web addresses/],
  ];
  for (const [url, why] of refusals) {
    await assert.rejects(fetch.run({ url }, signal), why, url);
  }
});

/// What the fake reader answers for an address: by default a page that stayed where it was asked for.
let answering: (url: string) => Read = (url) => ({ ok: true, url, title: "t", text: "x" });

test("a page is asked for by its address as parsed, and without the fragment its own script could read", async () => {
  const asked: string[] = [];
  const reader: Reader = sharedReader({
    send: (message) => {
      const { id, url } = (message as unknown as { data: { id: string; url: string } }).data;
      asked.push(url);
      queueMicrotask(() => reader.answer(id, answering(url)));
    },
    listen: () => undefined,
  });
  const signal = new AbortController().signal;
  await webFetchTool(PUBLIC).run({ url: "https://p.example/page#c2VjcmV0" }, signal);
  await webFetchTool(PUBLIC).run({ url: "http://evil.example\\@127.0.0.1:18765/x.pdf" }, signal);
  assert.deepEqual(asked, ["https://p.example/page", "http://evil.example/@127.0.0.1:18765/x.pdf"]);
});

test("a search is asked about with the words it would send", () => {
  assert.equal(webSearchTool().describe({ query: "what my notes say" }).carrying, "what my notes say");
});

test("a public name that leads to this machine or its network is not read, nor a page that ends up there", async () => {
  const signal = new AbortController().signal;
  const home = async (host: string) => (host === "127.0.0.1.nip.example" ? ["127.0.0.1"] : ["93.184.216.34"]);
  await assert.rejects(webFetchTool(home).run({ url: "http://127.0.0.1.nip.example:11434/api/tags" }, signal), /this machine or its network/);
  answering = () => ({ ok: true, url: "http://192.168.1.1/admin", title: "Router", text: "admin" });
  const led = (await webFetchTool(PUBLIC).run({ url: "https://p.example/redirects" }, signal)) as { failed?: boolean; reason?: string; text?: string };
  assert.equal(led.failed, true);
  assert.match(led.reason ?? "", /led to this machine or its network/);
  assert.equal(led.text, undefined, "what it found there is not handed back");
});

test("a page that does not say where it ended up is not handed back", async () => {
  answering = () => ({ ok: true, title: "Somewhere", text: "words" });
  const read = (await webFetchTool(PUBLIC).run({ url: "https://p.example/quiet" }, new AbortController().signal)) as { failed?: boolean; reason?: string };
  assert.equal(read.failed, true);
  assert.match(read.reason ?? "", /did not say where it ended up/);
});
