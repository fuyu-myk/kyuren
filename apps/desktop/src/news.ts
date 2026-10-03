import type { Firing } from "@/ambient";

const DAY = 24 * 60 * 60 * 1000;

/// How long after an event begins its notice is still worth a glance on the front page.
const AFTER = 60 * 60 * 1000;

/// Whether a firing still belongs on the front page: an event until an hour after it began, and
/// anything else for a day. A notice that said "starts in 8 minutes" is not news at four.
export function stillWorth(one: Firing, now: number): boolean {
  if (now - Date.parse(one.at) > DAY) return false;
  if (one.when && one.why.startsWith("starts in")) return Date.parse(one.when) + AFTER > now;
  return true;
}

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/// A moment as a time of day, in the machine's own clock.
export function timeOf(iso: string): string {
  const at = new Date(iso);
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

/// The time of day a firing is about, in the machine's own clock.
export function clockOf(one: Firing): string {
  return timeOf(one.when && one.why.startsWith("starts in") ? one.when : one.at);
}

/// When something is next due: the time alone if today, else the day with it.
export function nextOf(iso: string, now = Date.now()): string {
  const at = new Date(iso);
  const today = new Date(now);
  const sameDay = at.getFullYear() === today.getFullYear() && at.getMonth() === today.getMonth() && at.getDate() === today.getDate();
  return sameDay ? `today ${timeOf(iso)}` : `${DAYS[at.getDay()]} ${timeOf(iso)}`;
}

/// What is said beside the title. For an event the time already says it; for the rest, the why.
export function sayingOf(one: Firing): string {
  const how = one.when && one.why.startsWith("starts in") ? "" : one.why;
  return `${how}${one.voice ? (how ? ", spoken" : "spoken") : ""}`;
}
