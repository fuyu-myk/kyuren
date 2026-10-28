import { clock, dayOf, spoken } from "#brief/day.ts";
import type { Digest } from "#brief/digest.ts";
import { bySender } from "#brief/senders.ts";
import type { Item } from "#connect/source.ts";

export const OPEN = "<!-- kyuren:day -->";
export const CLOSE = "<!-- kyuren:end -->";
/// The evening's recap is a block of its own in the same note, under the morning's.
export const EVENING = "<!-- kyuren:evening -->";
export const EVENING_END = "<!-- kyuren:evening-end -->";

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
  if (from === -1 && to === -1 && whole(existing, EVENING, EVENING_END)) {
    // The evening was written first, so the morning goes above it.
    const evening = existing.indexOf(EVENING);
    return `${existing.slice(0, evening)}${block}\n\n${existing.slice(evening)}`;
  }
  if (from === -1 || to === -1 || to < from) {
    // Someone removed the markers, or wrote the file themselves. Theirs is the copy that stays.
    return existing;
  }

  return existing.slice(0, from) + block + existing.slice(to + CLOSE.length);
}

function whole(text: string, open: string, close: string): boolean {
  const from = text.indexOf(open);
  return from !== -1 && text.indexOf(close) > from;
}

/// The evening's block, rewritten where it is, or put under the morning's. Like the morning's, it
/// is never put in a note Kyuren has not written in, nor in one whose markers someone took away.
export function mergeEvening(existing: string | undefined, generated: string): string {
  const block = `${EVENING}\n${generated}\n${EVENING_END}`;
  if (!existing) return `${block}\n`;

  const from = existing.indexOf(EVENING);
  const to = existing.indexOf(EVENING_END);
  if (from !== -1 || to !== -1) {
    return whole(existing, EVENING, EVENING_END) ? existing.slice(0, from) + block + existing.slice(to + EVENING_END.length) : existing;
  }
  if (!whole(existing, OPEN, CLOSE)) return existing;

  const after = existing.indexOf(CLOSE) + CLOSE.length;
  return `${existing.slice(0, after)}\n\n${block}${existing.slice(after)}`;
}

export function noteName(day: string): string {
  return `${day}.md`;
}
