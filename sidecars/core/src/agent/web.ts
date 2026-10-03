import { z } from "zod";
import type { Tool } from "#agent/tool.ts";
import { leadsNearby, lookupAll, nearby, type Resolve } from "#connect/web/nearby.ts";
import { spaced } from "#connect/web/pace.ts";
import { readerIfAny, type Reader } from "#connect/web/reader.ts";
import { engineHosts, searchThrough } from "#connect/web/search.ts";
import { webEngine, webFallback } from "#settings.ts";

export const webSearchSchema = z.object({
  query: z.string().describe("what to search the web for, in a few words"),
});

export const webFetchSchema = z.object({
  url: z.string().describe("the full address of the page to read"),
  page: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("for a PDF, the page to start reading from, when an earlier read said where it stopped"),
});

/// Searches go one at a time, this far apart, whatever is running at once.
const SEARCH_GAP = 2_500;
const search = spaced(SEARCH_GAP);

function reader(): Reader {
  const found = readerIfAny();
  if (!found) throw new Error("no browser is available to read the web with");
  return found;
}

/// Searching the web through the host's own browser, at the engine the user set and, when that one
/// refuses or finds nothing, at the second. Declared as reaching out of the machine, and named by
/// both engines' hosts, since either may see the query.
export function webSearchTool(): Tool<z.infer<typeof webSearchSchema>> {
  return {
    name: "web_search",
    description: "Search the web for a few words and get a handful of results with addresses and snippets.",
    describe: (args) => ({
      tool: "web_search",
      effect: "outbound",
      target: engineHosts([webEngine(), webFallback()]),
      carrying: args.query,
    }),
    run: async (args) => {
      try {
        const searched = await searchThrough([webEngine(), webFallback()], args.query, (url) =>
          search(() => reader().read(url, "search")),
        );
        return { results: searched.results, from: searched.from };
      } catch (failure) {
        return { failed: true, reason: failure instanceof Error ? failure.message : String(failure) };
      }
    },
  };
}

/// The address a page is read at, or why it may not be. The reader reads the public web: aimed at
/// this machine or its network it would hand back what was never published, and a name and password
/// go to whoever is there. The fragment stays behind, since a page's own script reads it, and the
/// address goes on as parsed here, so whatever reads it next finds the same host.
async function readable(url: string, resolve: Resolve): Promise<{ at: string } | { refused: string }> {
  let where: URL;
  try {
    where = new URL(url);
  } catch {
    return { refused: "only web addresses can be read" };
  }
  if (where.protocol !== "http:" && where.protocol !== "https:") return { refused: "only web addresses can be read" };
  if (nearby(where.hostname) || (await leadsNearby(where.hostname, resolve))) {
    return { refused: "the reader does not reach this machine or its network" };
  }
  if (where.username !== "" || where.password !== "") return { refused: "an address may not carry a name and password" };
  where.hash = "";
  return { at: where.href };
}

/// Reading one page through the host's own browser: its title and the text of its main content.
/// Whether a page ended up on this machine or its network, after whatever it redirected through.
async function landedNearby(url: string, resolve: Resolve): Promise<boolean> {
  try {
    return await leadsNearby(new URL(url).hostname, resolve);
  } catch {
    return true;
  }
}

export function webFetchTool(resolve: Resolve = lookupAll): Tool<z.infer<typeof webFetchSchema>> {
  return {
    name: "web_fetch",
    description: "Read a web page or a PDF by its address and get its title and main text. A PDF comes back page by page, each page marked, so a paper can be read rather than its abstract.",
    describe: (args) => ({ tool: "web_fetch", effect: "outbound", target: args.url }),
    run: async (args) => {
      const address = await readable(args.url, resolve);
      if ("refused" in address) throw new Error(address.refused);
      const read = await reader().read(address.at, "page", args.page);
      if (!read.ok) return { failed: true, reason: read.reason ?? "the page could not be read" };
      if (!read.url) return { failed: true, reason: "the page did not say where it ended up" };
      if (await landedNearby(read.url, resolve)) return { failed: true, reason: "the page led to this machine or its network" };
      return { title: read.title ?? "", text: read.text ?? "" };
    },
  };
}
