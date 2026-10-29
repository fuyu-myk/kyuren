import { clockOf, dayName, todayOf, type Day, type Happening } from "./week.ts";

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

/// What a day of the week shows: its events, and the todos due on it.
export type Entry = { event: Happening } | { todo: Todo };

function dayDue(due: string): string {
  return due.length <= 10 ? due : todayOf(new Date(due).getTime());
}

function whenOf(entry: Entry): number {
  if ("event" in entry) return entry.event.timed ? new Date(entry.event.at).getTime() : 0;
  return entry.todo.due && entry.todo.due.length > 10 ? new Date(entry.todo.due).getTime() : 0;
}

/// A day with the open todos due on it among its events: those with no time first, events before
/// todos, then all by when they fall.
export function entriesOf(day: Day, todos: Todo[]): Entry[] {
  const due = todos.filter((one) => !one.done && one.due !== undefined && dayDue(one.due) === day.day);
  const entries: Entry[] = [...day.events.map((event) => ({ event })), ...due.map((todo) => ({ todo }))];
  return entries.sort((a, b) => whenOf(a) - whenOf(b));
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

/// A todo as its editor holds it.
export type Form = { text: string; date: string; time: string; priority: string };

function two(value: number): string {
  return `${value}`.padStart(2, "0");
}

/// When a todo is due, as the editor's day and time boxes hold it, in local time.
export function formOf(todo: Todo): Form {
  const priority = priorityOf(todo.priority) ?? "";
  if (!todo.due) return { text: todo.text, date: "", time: "", priority };
  if (todo.due.length <= 10) return { text: todo.text, date: todo.due, time: "", priority };
  const moment = new Date(todo.due);
  return { text: todo.text, date: todayOf(moment.getTime()), time: `${two(moment.getHours())}:${two(moment.getMinutes())}`, priority };
}

/// What an edit changes, and only that: a priority the database names its own way is not written
/// again unless it was changed, and a due day emptied is taken away.
export function changesOf(todo: Todo, form: Form): Partial<Form> {
  const was = formOf(todo);
  const changes: Partial<Form> = {};
  if (form.text.trim() !== todo.text) changes.text = form.text;
  if (form.date !== was.date || (form.date !== "" && form.time !== was.time)) {
    changes.date = form.date;
    changes.time = form.date ? form.time : "";
  }
  if (form.priority !== was.priority) changes.priority = form.priority;
  return changes;
}
