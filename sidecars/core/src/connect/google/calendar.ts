import { connected, google } from "#connect/google/api.ts";
import type { Item, Source, Span } from "#connect/source.ts";

const CALENDARS = "https://www.googleapis.com/calendar/v3/users/me/calendarList";
const EVENTS = "https://www.googleapis.com/calendar/v3/calendars";

type Entry = { id?: string; summary?: string; selected?: boolean; primary?: boolean };

type Event = {
  summary?: string;
  htmlLink?: string;
  status?: string;
  start?: { date?: string; dateTime?: string };
};

async function calendars(): Promise<Entry[]> {
  const listed = await google(`${CALENDARS}?maxResults=100&minAccessRole=reader`);
  const entries = (listed.items ?? []) as Entry[];
  // A calendar the user has hidden in their own client is one they have already said they do not
  // want to see. Primary is always included, hidden or not.
  return entries.filter((entry) => entry.id && (entry.selected !== false || entry.primary));
}

async function eventsIn(calendar: Entry, span: Span): Promise<Item[]> {
  const url = new URL(`${EVENTS}/${encodeURIComponent(calendar.id ?? "")}/events`);
  url.searchParams.set("timeMin", `${span.from}T00:00:00Z`);
  url.searchParams.set("timeMax", `${span.to}T23:59:59Z`);
  // Without this a weekly meeting arrives once, as its rule, rather than as the occurrences that
  // actually fall inside the span.
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", "100");

  const answer = await google(url.toString());
  const events = (answer.items ?? []) as Event[];

  return events.flatMap((event) => {
    if (event.status === "cancelled") return [];
    const at = event.start?.dateTime ?? event.start?.date;
    if (!at) return [];
    return [{
      source: "google",
      kind: "event" as const,
      collection: calendar.summary ?? "Calendar",
      title: event.summary ?? "untitled",
      at,
      timed: event.start?.dateTime !== undefined,
      done: false,
      url: event.htmlLink,
    }];
  });
}

export const googleCalendar: Source = {
  name: "google_calendar",
  effect: "outbound",
  origin: "https://www.googleapis.com/calendar",
  available: connected,

  async read(span: Span): Promise<Item[]> {
    const mine = await calendars();
    const gathered = await Promise.all(mine.map((calendar) => eventsIn(calendar, span)));
    return gathered.flat();
  },
};
