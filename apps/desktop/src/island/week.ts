/// An event as the island shows it, and the week of them the core reads: the calendar week holding
/// today, from Sunday or Monday as set, and the week after, where the next event may be.
export type Happening = { title: string; at: string; timed: boolean; source: string; collection: string };
export type Day = { day: string; events: Happening[] };
export type Week = { at: number; days: Day[]; after: Day[]; read: string[]; refused: string[]; unavailable: string[]; failed: string[] };

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const HOUR = 60;

/// How each calendar is named to the user, rather than by its name inside Kyuren.
const SOURCES: Record<string, string> = {
  apple_calendar: "Calendar",
  google_calendar: "Google Calendar",
  microsoft_calendar: "Outlook",
  notion: "Notion",
};

function localDay(moment: Date): string {
  const two = (value: number) => `${value}`.padStart(2, "0");
  return `${moment.getFullYear()}-${two(moment.getMonth() + 1)}-${two(moment.getDate())}`;
}

function dateOf(day: string): Date {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, date ?? 1);
}

function dayAfter(day: string, many: number): string {
  const moment = dateOf(day);
  moment.setDate(moment.getDate() + many);
  return localDay(moment);
}

/// The next event to start: the first with a time still ahead, this week or the next.
export function nextEvent(week: Week | null, now: number): Happening | undefined {
  return week ? [...week.days, ...(week.after ?? [])].flatMap((one) => one.events).find((one) => one.timed && new Date(one.at).getTime() > now) : undefined;
}

/// Today as the week names its days.
export function todayOf(now: number): string {
  return localDay(new Date(now));
}

/// How long until an event starts: minutes, then hours, today; its day, after.
export function until(at: string, now: number): string {
  const start = new Date(at);
  const left = start.getTime() - now;
  if (left <= 0) return "now";
  // To the nearest minute, and never none while it is still ahead.
  const minutes = Math.max(1, Math.round(left / 60_000));
  if (minutes < HOUR) return `in ${minutes} min`;
  const today = localDay(new Date(now));
  const day = localDay(start);
  if (day === today) {
    const rest = minutes % HOUR;
    return rest === 0 ? `in ${Math.floor(minutes / HOUR)} h` : `in ${Math.floor(minutes / HOUR)} h ${rest} min`;
  }
  return day === dayAfter(today, 1) ? "tomorrow" : `on ${WEEKDAYS[start.getDay()]}`;
}

export function dayName(day: string, today: string): string {
  if (day === today) return "today";
  if (day === dayAfter(today, 1)) return "tomorrow";
  const moment = dateOf(day);
  return `${WEEKDAYS[moment.getDay()]!.slice(0, 3)} ${moment.getDate()}`;
}

export function clockOf(at: string): string {
  const moment = new Date(at);
  const hours = moment.getHours();
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  const suffix = hours < 12 ? "am" : "pm";
  const minutes = moment.getMinutes();
  return minutes === 0 ? `${twelve} ${suffix}` : `${twelve}:${`${minutes}`.padStart(2, "0")} ${suffix}`;
}

export function sourceNames(sources: string[]): string {
  const names = sources.map((one) => SOURCES[one] ?? one);
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
