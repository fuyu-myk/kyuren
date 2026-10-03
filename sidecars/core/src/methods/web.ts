import { sharedReader, type Read } from "#connect/web/reader.ts";
import { searchThrough } from "#connect/web/search.ts";
import { webEngine, webFallback } from "#settings.ts";
import type { Transport } from "#transport.ts";

function readIn(params: Record<string, unknown>): Read {
  const results = Array.isArray(params.results) ? (params.results as Read["results"]) : undefined;
  return {
    ok: params.ok === true,
    url: typeof params.url === "string" ? params.url : undefined,
    title: typeof params.title === "string" ? params.title : undefined,
    text: typeof params.text === "string" ? params.text : undefined,
    results,
    reason: typeof params.reason === "string" ? params.reason : undefined,
  };
}

/// The host's side of reading the web: it answers the reads this process asked for, and the
/// window can try a search to see the browser and the engine working.
export function webHandlers(transport: Transport) {
  const reader = sharedReader(transport);

  return {
    "web.read.answer": async (params: Record<string, unknown>) => {
      const id = params.id;
      if (typeof id !== "string") throw new Error("web.read.answer needs the id of a read");
      return { matched: reader.answer(id, readIn(params)), pending: reader.pending() };
    },

    "web.search": async (params: Record<string, unknown>) => {
      const query = params.query;
      if (typeof query !== "string" || query.trim() === "") throw new Error("web.search needs a query");
      return searchThrough([webEngine(), webFallback()], query, (url) => reader.read(url, "search"));
    },

    "web.engine": async () => ({ engine: webEngine(), fallback: webFallback() }),
  };
}
