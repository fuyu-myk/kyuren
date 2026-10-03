import type { Found, Read } from "#connect/web/reader.ts";

/// Where a search goes unless the user says otherwise: DuckDuckGo's page without scripts, which
/// asks for no key and reads the same for everyone.
export const DEFAULT_ENGINE = "https://html.duckduckgo.com/html/?q={query}";

/// Where a search goes when the first engine refuses it or finds nothing: Bing's ordinary results
/// page, which also asks for no key. DuckDuckGo answers a burst of searches with a challenge, and
/// a research run is a burst.
export const FALLBACK_ENGINE = "https://www.bing.com/search?q={query}&setlang=en";

/// The address for a query, from a template with {query} in it. A template without the token
/// gets the query on the end, so a plain address still works.
export function searchUrl(template: string, query: string): string {
  const encoded = encodeURIComponent(query.trim());
  return template.includes("{query}") ? template.replaceAll("{query}", encoded) : `${template}${encoded}`;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/// What the search script found, as it posted it: a JSON list. Anything else is no results.
export function parseResults(text: string | undefined, most = 6): Found[] {
  if (!text) return [];
  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((one): one is Found => typeof one === "object" && one !== null && typeof (one as Found).url === "string")
      .map((one) => ({
        title: String(one.title ?? "").slice(0, 300),
        url: one.url.slice(0, 2000),
        snippet: String(one.snippet ?? "").slice(0, 500),
      }))
      .filter((one) => /^https?:\/\//.test(one.url))
      .slice(0, most);
  } catch {
    return [];
  }
}

export type Tried = { engine: string; reason: string };

export type Searched = { url: string; results: Found[]; from: string; tried: Tried[] };

/// One search through each engine in turn, until one answers with results. An engine that refuses
/// or finds nothing is noted and the next is asked. Nothing found anywhere is an answer; every
/// engine refusing is not, and says why, engine by engine.
export async function searchThrough(
  engines: string[],
  query: string,
  read: (url: string) => Promise<Read>,
): Promise<Searched> {
  const tried: Tried[] = [];
  let empty: string | undefined;
  for (const engine of [...new Set(engines)]) {
    const url = searchUrl(engine, query);
    const got = await read(url);
    if (!got.ok) {
      tried.push({ engine: hostOf(url), reason: got.reason ?? "the page could not be read" });
      continue;
    }
    const results = got.results ?? parseResults(got.text);
    if (results.length > 0) return { url, results, from: hostOf(url), tried };
    empty ??= url;
    tried.push({ engine: hostOf(url), reason: "it found nothing" });
  }
  if (empty) return { url: empty, results: [], from: hostOf(empty), tried };
  throw new Error(`no engine would search: ${tried.map((one) => `${one.engine}, ${one.reason}`).join("; ")}`);
}

/// The engines a search may reach, as the gate is shown them: approving a search approves every
/// engine it may go to, so every one is named.
export function engineHosts(engines: string[]): string {
  return [...new Set(engines.map((one) => `https://${hostOf(one)}`))].join(" or ");
}
