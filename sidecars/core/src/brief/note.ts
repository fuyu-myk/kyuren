import { clock, dayOf, spoken } from "#brief/day.ts";
import type { Digest } from "#brief/digest.ts";
import { bySender } from "#brief/senders.ts";
import type { Item } from "#connect/source.ts";

export const OPEN = "<!-- kyuren:day -->";
export const CLOSE = "<!-- kyuren:end -->";

/// Links are collected and named at the foot. A calendar address runs to four hundred characters,
/// and a line that long is not one anybody edits by hand.
type Links = { of: (url: string | undefined) => string; footer: () => string[] };

function links(): Links {
  const seen = new Map<string, number>();
  return {
    of: (url) => {
      if (!url) return "";
      const number = seen.get(url) ?? seen.size + 1;
      seen.set(url, number);
      return `[${number}]`;
    },
    footer: () =>
      seen.size === 0 ? [] : ["", ...[...seen].map(([url, number]) => `[${number}]: ${url}`)],
  };
}

function entry(item: Item, links: Links): string {
  const at = clock(item.at);
  const when = at ? `${spoken(dayOf(item.at))}, ${at}` : spoken(dayOf(item.at));
  const mark = links.of(item.url);
  const title = mark ? `[${item.title}]${mark}` : item.title;
  return `- ${when} — ${title} _(${item.collection})_`;
}

function section(heading: string, items: Item[], links: Links): string[] {
  return items.length > 0
    ? [`## ${heading}`, ...items.map((item) => entry(item, links)), ""]
    : [];
}

export function render(summary: Digest, read: string[]): string {
  const link = links();
  const lines = [
    `# ${spoken(summary.day)} ${summary.day.slice(0, 4)}`,
    "",
    ...section("Today", summary.now, link),
    ...section("Overdue", summary.overdue, link),
    ...section("Deadlines", summary.deadlines, link),
    ...section("Tomorrow", summary.tomorrow, link),
    ...(summary.messages.length > 0
      ? ["## Unread mail", ...bySender(summary.messages).map((one) => {
          const again = one.count > one.subjects.length ? ` _(${one.count} in all)_` : "";
          return `- **${one.sender}** — ${one.subjects.join("; ")}${again}`;
        }), ""]
      : []),
    ...(summary.missing.length > 0
      ? ["## Not included", ...summary.missing.map((one) => `- ${one}`), ""]
      : []),
    `_Read from ${read.length > 0 ? read.join(", ") : "nothing"}._`,
    ...link.footer(),
  ];

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}

/// Rewrites only what Kyuren wrote. The day's note is a file someone is invited to edit, and a
/// second reading of the same day must not throw their notes away.
export function merge(existing: string | undefined, generated: string): string {
  const block = `${OPEN}\n${generated}\n${CLOSE}`;
  if (!existing) return `${block}\n`;

  const from = existing.indexOf(OPEN);
  const to = existing.indexOf(CLOSE);
  if (from === -1 || to === -1 || to < from) {
    // Someone removed the markers, or wrote the file themselves. Theirs is the copy that stays.
    return existing;
  }

  return existing.slice(0, from) + block + existing.slice(to + CLOSE.length);
}

export function noteName(day: string): string {
  return `${day}.md`;
}
