import type { Item } from "#connect/source.ts";

export type Page = {
  id?: string;
  url?: string;
  properties?: Record<string, Record<string, unknown>>;
};

/// What is sat rather than handed in. A final alone is not one: a final project is work to finish.
const SAT = /\b(exam|midterm|quiz|test)s?\b/i;

function plain(rich: unknown): string {
  if (!Array.isArray(rich)) return "";
  return rich.map((part) => (part as { plain_text?: string }).plain_text ?? "").join("").trim();
}

export function itemOf(
  page: Page,
  collection: string,
  dateProperty: string,
  finished: Set<string>,
): Item | undefined {
  const properties = page.properties ?? {};
  const dated = properties[dateProperty] as { date?: { start?: string } } | undefined;
  const start = dated?.date?.start;
  if (!start) return undefined;

  let title = "";
  let status: string | undefined;
  let checked: boolean | undefined;
  const kinds: string[] = [];

  for (const value of Object.values(properties)) {
    const type = value.type as string | undefined;
    if (type === "title" && !title) title = plain(value.title);
    if (type === "status") status = (value.status as { name?: string } | null)?.name ?? status;
    if (type === "checkbox" && checked === undefined) checked = value.checkbox as boolean;
    if (type === "select") kinds.push((value.select as { name?: string } | null)?.name ?? "");
    if (type === "multi_select") {
      for (const one of (value.multi_select as Array<{ name?: string }> | null) ?? []) kinds.push(one.name ?? "");
    }
  }

  return {
    source: "notion",
    kind: "task",
    collection,
    title: title || "untitled",
    at: start,
    timed: start.length > 10,
    status,
    done: (status !== undefined && finished.has(status)) || checked === true,
    url: page.url,
    happening: SAT.test(title) || kinds.some((one) => SAT.test(one)),
  };
}
