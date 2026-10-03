import assert from "node:assert/strict";
import { test } from "node:test";
import type { Read } from "#connect/web/reader.ts";
import { DEFAULT_ENGINE, engineHosts, FALLBACK_ENGINE, hostOf, parseResults, searchThrough, searchUrl } from "#connect/web/search.ts";

test("a query goes into the engine's template, encoded", () => {
  assert.equal(searchUrl(DEFAULT_ENGINE, "kalman filter & noise"), "https://html.duckduckgo.com/html/?q=kalman%20filter%20%26%20noise");
  assert.equal(searchUrl("https://example.org/find?s=", "a b"), "https://example.org/find?s=a%20b");
  assert.equal(hostOf(DEFAULT_ENGINE), "html.duckduckgo.com");
});

test("results are what the page script posted, web addresses only, a handful at most", () => {
  const posted = JSON.stringify([
    { title: "One", url: "https://a.example/1", snippet: "first" },
    { title: "Bad", url: "javascript:alert(1)", snippet: "" },
    { title: "Two", url: "https://b.example/2", snippet: "second" },
  ]);
  const found = parseResults(posted);
  assert.deepEqual(found.map((one) => one.url), ["https://a.example/1", "https://b.example/2"]);
  assert.deepEqual(parseResults("not json"), []);
  assert.deepEqual(parseResults(undefined), []);
  assert.equal(parseResults(JSON.stringify(Array.from({ length: 20 }, (_, at) => ({ url: `https://x.example/${at}` })))).length, 6);
});

function engines(answers: Record<string, Read>) {
  const asked: string[] = [];
  return {
    asked,
    read: async (url: string): Promise<Read> => {
      asked.push(hostOf(url));
      return answers[hostOf(url)] ?? { ok: false, reason: "unknown engine" };
    },
  };
}

const found = (url: string) => JSON.stringify([{ title: "A", url, snippet: "" }]);

test("an engine that answers is the only one asked", async () => {
  const { asked, read } = engines({ "html.duckduckgo.com": { ok: true, text: found("https://a.example") } });
  const searched = await searchThrough([DEFAULT_ENGINE, FALLBACK_ENGINE], "diffusion", read);
  assert.deepEqual(asked, ["html.duckduckgo.com"]);
  assert.equal(searched.from, "html.duckduckgo.com");
  assert.deepEqual(searched.tried, []);
});

test("an engine that refuses, or finds nothing, hands the search to the next", async () => {
  const refusing = engines({
    "html.duckduckgo.com": { ok: false, reason: "the engine asked for a challenge" },
    "www.bing.com": { ok: true, text: found("https://b.example") },
  });
  const searched = await searchThrough([DEFAULT_ENGINE, FALLBACK_ENGINE], "diffusion", refusing.read);
  assert.deepEqual(refusing.asked, ["html.duckduckgo.com", "www.bing.com"]);
  assert.equal(searched.from, "www.bing.com");
  assert.equal(searched.url, "https://www.bing.com/search?q=diffusion&setlang=en");
  assert.deepEqual(searched.tried, [{ engine: "html.duckduckgo.com", reason: "the engine asked for a challenge" }]);

  const empty = engines({
    "html.duckduckgo.com": { ok: true, text: "[]" },
    "www.bing.com": { ok: true, text: found("https://b.example") },
  });
  assert.equal((await searchThrough([DEFAULT_ENGINE, FALLBACK_ENGINE], "diffusion", empty.read)).from, "www.bing.com");
});

test("nothing found anywhere is an answer, every engine refusing is not, and the same engine twice is asked once", async () => {
  const nothing = engines({ "html.duckduckgo.com": { ok: true, text: "[]" }, "www.bing.com": { ok: true, text: "[]" } });
  const searched = await searchThrough([DEFAULT_ENGINE, FALLBACK_ENGINE], "zzqx", nothing.read);
  assert.deepEqual(searched.results, []);
  assert.equal(searched.from, "html.duckduckgo.com");

  const refusing = engines({
    "html.duckduckgo.com": { ok: false, reason: "the engine asked for a challenge" },
    "www.bing.com": { ok: false, reason: "no answer within 45 s" },
  });
  await assert.rejects(
    searchThrough([DEFAULT_ENGINE, FALLBACK_ENGINE], "diffusion", refusing.read),
    /html\.duckduckgo\.com, the engine asked for a challenge; www\.bing\.com, no answer within 45 s/,
  );

  const once = engines({ "html.duckduckgo.com": { ok: false, reason: "challenge" } });
  await assert.rejects(searchThrough([DEFAULT_ENGINE, DEFAULT_ENGINE], "diffusion", once.read));
  assert.deepEqual(once.asked, ["html.duckduckgo.com"]);
});

test("the gate is shown every engine a search may reach, and one engine is one address", () => {
  assert.equal(engineHosts([DEFAULT_ENGINE, FALLBACK_ENGINE]), "https://html.duckduckgo.com or https://www.bing.com");
  assert.equal(engineHosts([DEFAULT_ENGINE, DEFAULT_ENGINE]), "https://html.duckduckgo.com");
});
