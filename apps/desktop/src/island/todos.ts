import { clockOf, dayName, todayOf } from "./week.ts";

/// A todo as it is kept in Notion, and the list as the core reads it: the database it is kept in,
/// what that database can hold, and the todos not yet done; or, with none, why.
export type Todo = { id: string; text: string; due?: string; priority?: string; done: boolean; url?: string };
export type Listed = {
  database?: string;
  fields?: { date: boolean; priority: boolean; done: boolean };
  todos: Todo[];
  missing?: "unchosen" | "unconnected" | "refused" | "unshaped";
};
export type Adding = { text: string; date?: string; time?: string; priority?: string; note?: string };

export const PRIORITIES = ["high", "medium", "low"] as const;

/// When a todo is due, as the list says it: its day as the week names days, with its time if it has
/// one, and whether that has passed.
export function dueOf(due: string | undefined, now: number): { said: string; overdue: boolean } | undefined {
  if (!due) return undefined;
  const today = todayOf(now);
  if (due.length <= 10) return { said: dayName(due, today), overdue: due < today };
  const moment = new Date(due);
  if (Number.isNaN(moment.getTime())) return undefined;
  return { said: `${dayName(todayOf(moment.getTime()), today)} ${clockOf(due)}`, overdue: moment.getTime() < now };
}

/// A priority as the database names it, read as one of the three, for its colour.
export function priorityOf(name: string | undefined): (typeof PRIORITIES)[number] | undefined {
  const said = (name ?? "").toLowerCase();
  return PRIORITIES.find((one) => said.includes(one));
}

export function missingSaid(missing: NonNullable<Listed["missing"]>): string {
  switch (missing) {
    case "unchosen":
      return "Choose a Notion database for todos in System settings.";
    case "unconnected":
      return "Connect Notion in System settings to keep todos there.";
    case "refused":
      return "Kyuren may not read Notion yet: choose the database for todos again in settings.";
    case "unshaped":
      return "That database has no title to keep todos in: choose another in settings.";
  }
}
