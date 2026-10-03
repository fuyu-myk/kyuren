import { connected, graph } from "#connect/microsoft/api.ts";
import type { Item, Source, Span } from "#connect/source.ts";

type Event = {
  subject?: string;
  webLink?: string;
  isAllDay?: boolean;
  isCancelled?: boolean;
  start?: { dateTime?: string; timeZone?: string };
};

/// The calendar view rather than the event list. Asking for events returns recurrence rules; the
/// view returns the occurrences that actually fall inside the span.
export const microsoftCalendar: Source = {
  name: "microsoft_calendar",
  effect: "outbound",
  origin: "https://graph.microsoft.com/calendar",
  available: connected,

  async read(span: Span): Promise<Item[]> {
    const path = `/me/calendarView?startDateTime=${span.from}T00:00:00`
      + `&endDateTime=${span.to}T23:59:59&$top=100&$orderby=start/dateTime`;

    const answer = await graph(path);
    const events = (answer.value ?? []) as Event[];

    return events.flatMap((event) => {
      if (event.isCancelled) return [];
      const at = event.start?.dateTime;
      if (!at) return [];
      return [{
        source: "microsoft_calendar",
        kind: "event" as const,
        collection: "Calendar",
        title: event.subject ?? "untitled",
        // Graph returns a naive timestamp with the zone beside it rather than an offset inside it.
        at: event.isAllDay ? at.slice(0, 10) : `${at.replace(/\.\d+$/, "")}Z`,
        timed: event.isAllDay !== true,
        done: false,
        url: event.webLink,
      }];
    });
  },
};
