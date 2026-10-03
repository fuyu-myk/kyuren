import { DAYS, type Day, type Schedule } from "#ambient/rules.ts";

/// How long after its time a schedule is still run. A machine asleep at the time runs what it
/// slept through on waking, but a review due at half past seven is not a review at three.
export const LATE = 30 * 60_000;

const APART = String.fromCharCode(31);

export type Due = { schedule: Schedule; due: Date };

function dayOf(date: Date): Day {
  return DAYS[(date.getDay() + 6) % 7]!;
}

function runsOn(schedule: Schedule, day: Date): boolean {
  return !schedule.on || schedule.on.includes(dayOf(day));
}

/// The moment a schedule's time falls on a day, in the machine's own clock.
function atOn(schedule: Schedule, day: Date): Date {
  const [hours, minutes] = schedule.at.split(":").map(Number) as [number, number];
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours, minutes, 0, 0);
}

function daysFrom(date: Date, count: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + count);
}

/// When a schedule is next due after a moment. Within a week there is always a day it names.
export function nextDue(schedule: Schedule, after: Date): Date {
  for (let ahead = 0; ahead <= 7; ahead += 1) {
    const day = daysFrom(after, ahead);
    const due = atOn(schedule, day);
    if (due > after && runsOn(schedule, day)) return due;
  }
  throw new Error(`schedule ${schedule.id} names no day`);
}

/// What came due between two looks: each schedule whose time passed since the last look, as long
/// as it passed no longer ago than LATE. Before any look, only what is due within LATE of now,
/// so a core started at half past seven runs the half past seven review, once.
export function dueBetween(schedules: Schedule[], since: Date | undefined, now: Date): Due[] {
  const from = Math.max(since?.getTime() ?? 0, now.getTime() - LATE);
  const found: Due[] = [];
  for (const schedule of schedules) {
    // A moment within LATE of now falls on today or, just after midnight, on yesterday.
    for (const day of [daysFrom(now, -1), now]) {
      if (!runsOn(schedule, day)) continue;
      const due = atOn(schedule, day);
      if (due.getTime() > from && due <= now) found.push({ schedule, due });
    }
  }
  return found;
}

/// One moment of one schedule runs once, however many times it is looked at.
export function keyOf(schedule: Schedule, due: Date): string {
  return `${schedule.id}${APART}${due.toISOString()}`;
}
