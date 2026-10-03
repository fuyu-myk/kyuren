import { notion, tokenHeld } from "#connect/notion/api.ts";
import { itemOf, type Page } from "#connect/notion/item.ts";
import { dateProperty, finishedNames, type Schema } from "#connect/notion/schema.ts";
import type { Item, Source, Span } from "#connect/source.ts";

const PER_SOURCE = 50;

type Dated = {
  id: string;
  title: string;
  property: string;
  finished: Set<string>;
};

function titleOf(entry: Record<string, unknown>): string {
  const title = entry.title;
  if (!Array.isArray(title)) return "untitled";
  return title.map((part) => (part as { plain_text?: string }).plain_text ?? "").join("").trim()
    || "untitled";
}

/// Whatever has been shared with the integration and carries a date is what the brief reads. The
/// workspace is not configured here, it is discovered, so sharing one more database is all it
/// takes to include it.
async function datedSources(): Promise<Dated[]> {
  const found = await notion("/v1/search", { page_size: 100 });
  const results = (found.results ?? []) as Array<Record<string, unknown>>;

  return results.flatMap((entry) => {
    if (entry.object !== "data_source") return [];
    const schema = (entry.properties ?? {}) as Schema;
    const property = dateProperty(schema);
    if (!property || typeof entry.id !== "string") return [];
    return [{
      id: entry.id,
      title: titleOf(entry),
      property,
      finished: finishedNames(schema),
    }];
  });
}

async function itemsOf(dated: Dated, span: Span): Promise<Item[]> {
  const answer = await notion(`/v1/data_sources/${dated.id}/query`, {
    page_size: PER_SOURCE,
    filter: {
      and: [
        { property: dated.property, date: { on_or_after: span.from } },
        { property: dated.property, date: { on_or_before: span.to } },
      ],
    },
    sorts: [{ property: dated.property, direction: "ascending" }],
  });

  const pages = (answer.results ?? []) as Page[];
  return pages.flatMap((page) => {
    const item = itemOf(page, dated.title, dated.property, dated.finished);
    return item ? [item] : [];
  });
}

export const notionSource: Source = {
  name: "notion",

  effect: "outbound",
  origin: process.env.KYUREN_NOTION_URL ?? "https://api.notion.com",

  available: tokenHeld,

  async read(span: Span): Promise<Item[]> {
    const dated = await datedSources();
    const gathered = await Promise.all(dated.map((one) => itemsOf(one, span)));
    return gathered.flat().sort((a, b) => a.at.localeCompare(b.at));
  },
};
