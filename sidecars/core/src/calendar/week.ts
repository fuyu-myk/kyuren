import type { Ask } from "#agent/tool.ts";
import { dayOf, nextDay, today } from "#brief/day.ts";
import { appleCalendar } from "#connect/apple/calendar.ts";
import { googleCalendar } from "#connect/google/calendar.ts";
import { microsoftCalendar } from "#connect/microsoft/calendar.ts";
import { notionSource } from "#connect/notion/source.ts";
import { gather, type Gathered } from "#connect/read.ts";
import type { Item, Source, Span } from "#connect/source.ts";
import type { Gate } from "#permission/gate.ts";

/// The calendars the brief reads, and Notion for the dated events in its databases.
export const CALENDARS: Source[] = [appleCalendar, googleCalendar, microsoftCalendar, notionSource];
/// How many days a week holds.
export const DAYS = 7;
/// How long a reading is held before the calendars are read again.
const HELD = 4 * 60_000;

export type Happening = { title: string; at: string; timed: boolean; source: string; collection: string };
export type Day = { day: string; events: Happening[] };
/// The calendar week holding today, and the week after it, where the next event may be.
export type Week = { at: number; days: Day[]; after: Day[]; read: string[]; refused: string[]; unavailable: string[]; failed: string[] };

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

function shifted(day: string, by: number): string {
  const [year, month, date] = day.split("-").map(Number);
  return today(new Date(year!, month! - 1, date! + by));
}

/// The first day of the calendar week holding a moment: a Sunday, or a Monday as chosen.
export function weekStart(now: Date, monday = false): string {
  const back = monday ? (now.getDay() + 6) % 7 : now.getDay();
  return today(new Date(now.getFullYear(), now.getMonth(), now.getDate() - back));
}

/// What is read for the weeks from a day: their days and one either side, as some calendars count
/// days in UTC and would otherwise lose an evening or a morning at the edges.
export function weekSpan(start: string, weeks = 1): Span {
  return { from: shifted(start, -1), to: shifted(start, DAYS * weeks) };
}

/// Whether anything with a time is still to start in these days, as the next event counted down.
function ahead(days: Day[], now: Date): boolean {
  return days.some((one) => one.events.some((event) => event.timed && new Date(event.at).getTime() > now.getTime()));
}

/// The calendar week holding today, Sunday to Saturday or Monday to Sunday, and the week after, each
/// day with its events: those without a time first, then by when they start.
export function weekOf(items: Item[], now: Date, monday = false): Pick<Week, "days" | "after"> {
  const seen = new Set<string>();
  const events = items.filter((item) => {
    if (item.kind !== "event" || seen.has(sameAs(item))) return false;
    seen.add(sameAs(item));
    return true;
  });
  const days = [weekStart(now, monday)];
  while (days.length < 2 * DAYS) days.push(nextDay(days[days.length - 1]!));
  const all = days.map((day) => ({
    day,
    events: events
      .filter((item) => dayOf(item.at) === day)
      .sort(earlier)
      .map(({ title, at, timed, source, collection }) => ({ title, at, timed, source, collection })),
  }));
  return { days: all.slice(0, DAYS), after: all.slice(DAYS) };
}

/// The week as the island shows it, read for its own days, and for the week after only once nothing
/// is left in it. Read on its own, it reads only the calendars already allowed and reports the
/// rest, as anything read with nobody asked does; read because someone pressed for it, it asks.
export class WeekReader {
  private readonly gate: Gate;
  private readonly told: (week: Week) => void;
  private readonly sources: Source[];
  private readonly clock: () => Date;
  private held: { at: number; start: string; far: boolean; gathered: Gathered } | undefined;
  private reading: { start: string; read: Promise<{ far: boolean; gathered: Gathered }> } | undefined;

  constructor(gate: Gate, told: (week: Week) => void, sources: Source[] = CALENDARS, clock: () => Date = () => new Date()) {
    this.gate = gate;
    this.told = told;
    this.sources = sources;
    this.clock = clock;
  }

  /// The week as last read, the calendars read again when the reading is old, the week begins on
  /// another day, or someone is there to be asked.
  async week(ask?: Ask, monday = false): Promise<Week> {
    const now = this.clock();
    const start = weekStart(now, monday);
    const held = this.held;
    const kept = !ask && held !== undefined && held.start === start && now.getTime() - held.at < HELD && today(new Date(held.at)) === today(now);
    let gathered: Gathered;
    if (kept) {
      gathered = held.gathered;
    } else {
      const shared = !ask && this.reading?.start === start ? this.reading : undefined;
      const reading = shared ?? { start, read: this.read(start, now, monday, held?.start === start && held.far, ask) };
      if (!ask) this.reading = reading;
      try {
        const read = await reading.read;
        gathered = read.gathered;
        this.held = { at: now.getTime(), start, far: read.far, gathered };
      } finally {
        if (this.reading === reading) this.reading = undefined;
      }
    }

    const week: Week = {
      at: this.held!.at,
      ...weekOf(gathered.items, now, monday),
      read: gathered.read,
      refused: gathered.refused,
      unavailable: gathered.unavailable,
      failed: gathered.failed.map((one) => one.source),
    };
    // The island is told each new reading, whoever asked for it.
    if (!kept) this.told(week);
    return week;
  }

  /// This week, and the week after with it once nothing is left in this one; a week already found
  /// empty ahead is read with the next from the start. A calendar answered once is not asked again.
  private async read(start: string, now: Date, monday: boolean, far: boolean, ask?: Ask): Promise<{ far: boolean; gathered: Gathered }> {
    if (!far) {
      const gathered = await gather(this.sources, weekSpan(start), this.gate, ask);
      if (ahead(weekOf(gathered.items, now, monday).days, now)) return { far: false, gathered };
    }
    return { far: true, gathered: await gather(this.sources, weekSpan(start, 2), this.gate, ask) };
  }
}
