import { apple } from "#connect/apple/helper.ts";
import type { Item, Source, Span } from "#connect/source.ts";

type Entry = {
  collection: string;
  title: string;
  at: string;
  timed: boolean;
  url?: string;
};

/// Nothing is stored for this connection. The Mac already holds the accounts, and permission is
/// the system's to grant rather than Kyuren's to keep.
export const appleCalendar: Source = {
  name: "apple_calendar",
  effect: "personal",
  origin: "eventkit://calendars",
  available: () => true,

  async read(span: Span): Promise<Item[]> {
    const entries = await apple<Entry[]>([
      "calendar",
      "--from",
      span.from,
      "--to",
      span.to,
    ]);

    return entries.map((entry) => ({
      source: "apple_calendar",
      kind: "event" as const,
      collection: entry.collection,
      title: entry.title,
      at: entry.at,
      timed: entry.timed,
      done: false,
      url: entry.url,
    }));
  },
};
