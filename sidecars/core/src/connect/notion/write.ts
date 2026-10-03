import { notion } from "#connect/notion/api.ts";
import { dateProperty, titleProperty, type Schema } from "#connect/notion/schema.ts";

export type Written = {
  id: string;
  url?: string;
  database: string;
};

type Source = {
  id?: string;
  object?: string;
  title?: Array<{ plain_text?: string }>;
  properties?: Schema;
};

async function sourceById(id: string): Promise<Source | undefined> {
  const found = await notion("/v1/search", { page_size: 100 });
  const results = (found.results ?? []) as Source[];
  return results.find((one) => one.object === "data_source" && one.id === id);
}

export async function databasesAvailable(): Promise<Array<{ id: string; title: string }>> {
  const found = await notion("/v1/search", { page_size: 100 });
  return ((found.results ?? []) as Source[])
    .filter((one) => one.object === "data_source" && typeof one.id === "string")
    .map((one) => ({
      id: one.id as string,
      title: (one.title ?? []).map((part) => part.plain_text ?? "").join("").trim() || "untitled",
    }));
}

/// Adds one entry. Deliberately narrow: a title, and a date if the database keeps one. Anything
/// that could rewrite an existing page is not offered, because nothing here has been asked to.
export async function addPage(options: {
  databaseId: string;
  title: string;
  date?: string;
}): Promise<Written> {
  const source = await sourceById(options.databaseId);
  if (!source) {
    throw new Error("that database is not shared with Kyuren's integration");
  }

  const schema = (source.properties ?? {}) as Schema;
  const titleName = titleProperty(schema);
  if (!titleName) throw new Error("that database has no title to write");

  const properties: Record<string, unknown> = {
    [titleName]: { title: [{ text: { content: options.title } }] },
  };

  const dateName = options.date ? dateProperty(schema) : undefined;
  if (dateName && options.date) {
    properties[dateName] = { date: { start: options.date } };
  }

  const made = await notion("/v1/pages", {
    parent: { type: "data_source_id", data_source_id: options.databaseId },
    properties,
  });

  return {
    id: typeof made.id === "string" ? made.id : "",
    url: typeof made.url === "string" ? made.url : undefined,
    database: options.databaseId,
  };
}
