import type { Ask } from "#agent/tool.ts";
import { dayOf, nextDay, today } from "#brief/day.ts";
import { appleCalendar } from "#connect/apple/calendar.ts";
import { googleCalendar } from "#connect/google/calendar.ts";
import { microsoftCalendar } from "#connect/microsoft/calendar.ts";
import { notionSource } from "#connect/notion/source.ts";
import { gather } from "#connect/read.ts";
import { spanAround, type Item, type Source } from "#connect/source.ts";
import type { Gate } from "#permission/gate.ts";

/// The calendars the brief reads, and Notion for the dated events in its databases.
export const CALENDARS: Source[] = [appleCalendar, googleCalendar, microsoftCalendar, notionSource];
/// How many days the week holds, today first.
export const DAYS = 7;
/// How long a reading is held before the calendars are read again.
const HELD = 4 * 60_000;

export type Happening = { title: string; at: string; timed: boolean; source: string; collection: string };
export type Day = { day: string; events: Happening[] };
export type Week = { at: number; days: Day[]; read: string[]; refused: string[]; unavailable: string[]; failed: string[] };

/// The same event in two calendars, as when the Mac's calendar also holds a Google account, is one
/// event: the same title at the same moment, however each writes the moment.
function sameAs(item: Item): string {
  const when = item.timed ? String(new Date(item.at).getTime()) : item.at.slice(0, 10);
  return `${item.title.trim().toLowerCase()}|${when}`;
}

function earlier(a: Item, b: Item): number {
  if (a.timed !== b.timed) return a.timed ? 1 : -1;
  return a.timed ? new Date(a.at).getTime() - new Date(b.at).getTime() : a.title.localeCompare(b.title);
}

/// The seven days from today, each with its events: those without a time first, then by when they
/// start.
export function weekOf(items: Item[], now: Date): Day[] {
  const seen = new Set<string>();
  const events = items.filter((item) => {
    if (item.kind !== "event" || seen.has(sameAs(item))) return false;
    seen.add(sameAs(item));
    return true;
  });
  const days = [today(now)];
  while (days.length < DAYS) days.push(nextDay(days[days.length - 1]!));
  return days.map((day) => ({
    day,
    events: events
      .filter((item) => dayOf(item.at) === day)
      .sort(earlier)
      .map(({ title, at, timed, source, collection }) => ({ title, at, timed, source, collection })),
  }));
}

/// The week as the island shows it. Read on its own, it reads only the calendars already allowed
/// and reports the rest, as anything read with nobody asked does; read because someone pressed for
/// it, it asks.
export class WeekReader {
  private readonly gate: Gate;
  private readonly told: (week: Week) => void;
  private readonly sources: Source[];
  private readonly clock: () => Date;
  private held: Week | undefined;
  private reading: Promise<Week> | undefined;

  constructor(gate: Gate, told: (week: Week) => void, sources: Source[] = CALENDARS, clock: () => Date = () => new Date()) {
    this.gate = gate;
    this.told = told;
    this.sources = sources;
    this.clock = clock;
  }

  async week(ask?: Ask): Promise<Week> {
    const now = this.clock();
    const fresh = this.held && now.getTime() - this.held.at < HELD && this.held.days[0]?.day === today(now);
    if (!ask && fresh) return this.held!;
    if (!ask && this.reading) return this.reading;

    const reading = this.read(now, ask);
    if (!ask) this.reading = reading;
    try {
      const week = await reading;
      this.held = week;
      this.told(week);
      return week;
    } finally {
      if (this.reading === reading) this.reading = undefined;
    }
  }

  private async read(now: Date, ask?: Ask): Promise<Week> {
    const gathered = await gather(this.sources, spanAround(now, 1, DAYS + 1), this.gate, ask);
    return {
      at: now.getTime(),
      days: weekOf(gathered.items, now),
      read: gathered.read,
      refused: gathered.refused,
      unavailable: gathered.unavailable,
      failed: gathered.failed.map((one) => one.source),
    };
  }
}
