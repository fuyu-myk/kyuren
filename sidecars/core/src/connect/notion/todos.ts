import { localStamp } from "#brief/day.ts";
import { notion } from "#connect/notion/api.ts";
import { dateProperty, finishedNames, titleProperty, type Schema } from "#connect/notion/schema.ts";

export const PRIORITIES = ["high", "medium", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];

/// A todo as the island shows it: its words, when it is due, its priority, and whether it is done.
export type Todo = { id: string; text: string; due?: string; priority?: string; done: boolean; url?: string };
export type Adding = { text: string; date?: string; time?: string; priority?: Priority; note?: string };
/// What an edit changes, and only that: a due day of none, or a priority of none, empties it.
export type Editing = { text?: string; due?: { date: string; time?: string } | null; priority?: Priority | null };

/// Where a database keeps a todo's words, date and priority, and how it says one is done: a status
/// whose Complete group means done, or else a checkbox.
export type Shape = {
  title: string;
  date?: string;
  priority?: { property: string; options: string[] };
  status?: { property: string; done: string; open: string; finished: string[] };
  checkbox?: string;
};

/// As long as a todo's words and its note may be.
const WORDS = 200;
const NOTE = 2_000;
/// How many open todos are read at once.
const LISTED = 100;
const CONTROL = /\p{Cc}/u;

function plain(rich: unknown): string {
  if (!Array.isArray(rich)) return "";
  return rich.map((part) => (part as { plain_text?: string }).plain_text ?? "").join("").trim();
}

export function shapeOf(schema: Schema): Shape | undefined {
  const title = titleProperty(schema);
  if (!title) return undefined;
  const shape: Shape = { title };
  const date = dateProperty(schema);
  if (date) shape.date = date;

  const priority = Object.entries(schema).find(([name, property]) => property.type === "select" && name.trim().toLowerCase() === "priority");
  if (priority) shape.priority = { property: priority[0], options: (priority[1].select?.options ?? []).flatMap((one) => (one.name ? [one.name] : [])) };

  const status = Object.entries(schema).find(([, property]) => property.type === "status" && property.status);
  const finished = [...finishedNames(schema)];
  if (status && finished.length > 0) {
    const options = new Map((status[1].status?.options ?? []).map((one) => [one.id ?? "", one.name ?? ""]));
    const groups = status[1].status?.groups ?? [];
    const todo = groups.find((group) => /^to[- ]?do$/i.test(group.name ?? "")) ?? groups.find((group) => (group.name ?? "").toLowerCase() !== "complete");
    const open = options.get(todo?.option_ids?.[0] ?? "");
    if (open) shape.status = { property: status[0], done: finished[0]!, open, finished };
  }
  if (!shape.status) {
    const checkbox = Object.entries(schema).find(([, property]) => property.type === "checkbox");
    if (checkbox) shape.checkbox = checkbox[0];
  }
  return shape;
}

/// What is not done, as Notion is asked for it; nothing for a database that cannot say.
export function openFilter(shape: Shape): Record<string, unknown> | undefined {
  if (shape.status) return { and: shape.status.finished.map((name) => ({ property: shape.status!.property, status: { does_not_equal: name } })) };
  if (shape.checkbox) return { property: shape.checkbox, checkbox: { equals: false } };
  return undefined;
}

export function todoOf(page: { id?: string; url?: string; properties?: Record<string, Record<string, unknown>> }, shape: Shape): Todo {
  const properties = page.properties ?? {};
  const due = (properties[shape.date ?? ""]?.date as { start?: string } | null | undefined)?.start;
  const priority = shape.priority ? (properties[shape.priority.property]?.select as { name?: string } | null | undefined)?.name : undefined;
  const status = shape.status ? (properties[shape.status.property]?.status as { name?: string } | null | undefined)?.name : undefined;
  const checked = shape.checkbox ? properties[shape.checkbox]?.checkbox === true : false;
  return {
    id: page.id ?? "",
    text: plain(properties[shape.title]?.title) || "untitled",
    ...(due ? { due } : {}),
    ...(priority ? { priority } : {}),
    done: (status !== undefined && (shape.status?.finished ?? []).includes(status)) || checked,
    ...(page.url ? { url: page.url } : {}),
  };
}

function realDate(day: string): boolean {
  const [year, month, date] = day.split("-").map(Number);
  const moment = new Date(year!, month! - 1, date!);
  return moment.getFullYear() === year && moment.getMonth() === month! - 1 && moment.getDate() === date;
}

function given(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error(`a todo's ${key} is text`);
  return value;
}

function wordsOf(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error("a todo needs something to say");
  const text = value.trim();
  if (text.length > WORDS || CONTROL.test(text)) throw new Error(`a todo is one line of at most ${WORDS} characters`);
  return text;
}

function dueOf(params: Record<string, unknown>): { date?: string; time?: string } {
  const date = given(params, "date");
  if (date !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !realDate(date))) throw new Error("a todo's date is a day, as 2026-10-30");
  const time = given(params, "time");
  if (time !== undefined && date === undefined) throw new Error("a time needs a date");
  if (time !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("a todo's time is an hour and minute, as 14:05");
  return { ...(date ? { date } : {}), ...(time ? { time } : {}) };
}

function priorityIn(params: Record<string, unknown>): Priority | undefined {
  const priority = given(params, "priority");
  if (priority !== undefined && !PRIORITIES.includes(priority as Priority)) throw new Error(`a priority is ${PRIORITIES.join(", ")}`);
  return priority as Priority | undefined;
}

/// A todo to add, as asked for, checked here at the edge: one line of words, a real date, a time
/// only with a date, a priority among those offered, and a note of plain lines.
export function addingOf(params: Record<string, unknown>): Adding {
  const text = wordsOf(params.text);
  const { date, time } = dueOf(params);
  const priority = priorityIn(params);
  const note = given(params, "note");
  if (note !== undefined && (note.length > NOTE || /(?![\n\t])\p{Cc}/u.test(note))) throw new Error(`a note is plain text of at most ${NOTE} characters`);

  return { text, ...(date ? { date } : {}), ...(time ? { time } : {}), ...(priority ? { priority } : {}), ...(note ? { note } : {}) };
}

/// An edit, as asked for, checked as an addition is. What is not given is unchanged; a date or a
/// priority given empty is taken away.
export function editingOf(params: Record<string, unknown>): Editing {
  const present = (key: string) => params[key] !== undefined && params[key] !== null;
  const editing: Editing = {};
  if (present("text")) editing.text = wordsOf(params.text);
  if (present("date") || present("time")) {
    const { date, time } = dueOf(params);
    editing.due = date ? { date, ...(time ? { time } : {}) } : null;
  }
  if (present("priority")) editing.priority = priorityIn(params) ?? null;
  return editing;
}

/// When a todo is due, as Notion keeps it: a day, or a moment in local time.
function startOf(date: string, time?: string): string {
  if (!time) return date;
  const [year, month, day] = date.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  return localStamp(new Date(year!, month! - 1, day!, hours!, minutes!));
}

/// A priority as the database already names it, so one is not added twice in another case.
function priorityName(options: string[], priority: Priority): string {
  return options.find((one) => one.toLowerCase() === priority) ?? `${priority[0]!.toUpperCase()}${priority.slice(1)}`;
}

/// The properties an edit writes. What the database has no place for is left out.
export function editProperties(editing: Editing, shape: Shape): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  if (editing.text !== undefined) properties[shape.title] = { title: [{ text: { content: editing.text } }] };
  if (editing.due !== undefined && shape.date) properties[shape.date] = { date: editing.due ? { start: startOf(editing.due.date, editing.due.time) } : null };
  if (editing.priority !== undefined && shape.priority) {
    properties[shape.priority.property] = { select: editing.priority ? { name: priorityName(shape.priority.options, editing.priority) } : null };
  }
  return properties;
}

/// The properties a todo is written with. What the database has no place for is left out.
export function propertiesFor(adding: Adding, shape: Shape): Record<string, unknown> {
  const properties: Record<string, unknown> = { [shape.title]: { title: [{ text: { content: adding.text } }] } };
  if (shape.date && adding.date) properties[shape.date] = { date: { start: startOf(adding.date, adding.time) } };
  if (shape.priority && adding.priority) properties[shape.priority.property] = { select: { name: priorityName(shape.priority.options, adding.priority) } };
  return properties;
}

export function doneProperties(shape: Shape, done: boolean): Record<string, unknown> | undefined {
  if (shape.status) return { [shape.status.property]: { status: { name: done ? shape.status.done : shape.status.open } } };
  if (shape.checkbox) return { [shape.checkbox]: { checkbox: done } };
  return undefined;
}

export function noteBlocks(note: string | undefined): Array<Record<string, unknown>> {
  return (note ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => ({ object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: line } }] } }));
}

/// A database's title and shape, from Notion.
export async function databaseShape(id: string): Promise<{ title: string; shape?: Shape }> {
  const found = await notion(`/v1/data_sources/${encodeURIComponent(id)}`);
  const title = plain(found.title) || "untitled";
  return { title, shape: shapeOf((found.properties ?? {}) as Schema) };
}

/// The todos not yet done, soonest due first.
export async function openTodos(id: string, shape: Shape): Promise<Todo[]> {
  const filter = openFilter(shape);
  const answer = await notion(`/v1/data_sources/${encodeURIComponent(id)}/query`, {
    page_size: LISTED,
    ...(filter ? { filter } : {}),
    sorts: shape.date ? [{ property: shape.date, direction: "ascending" }, { timestamp: "created_time", direction: "ascending" }] : [{ timestamp: "created_time", direction: "ascending" }],
  });
  return ((answer.results ?? []) as Array<Parameters<typeof todoOf>[0]>).map((page) => todoOf(page, shape));
}

export async function addTodo(id: string, shape: Shape, adding: Adding): Promise<void> {
  const children = noteBlocks(adding.note);
  await notion("/v1/pages", {
    parent: { type: "data_source_id", data_source_id: id },
    properties: propertiesFor(adding, shape),
    ...(children.length > 0 ? { children } : {}),
  });
}

export async function editTodo(page: string, shape: Shape, editing: Editing): Promise<void> {
  const properties = editProperties(editing, shape);
  if (Object.keys(properties).length === 0) return;
  await notion(`/v1/pages/${encodeURIComponent(page)}`, { properties }, "PATCH");
}

export async function markTodo(page: string, shape: Shape, done: boolean): Promise<void> {
  const properties = doneProperties(shape, done);
  if (!properties) throw new Error("that database has no status or checkbox to tick");
  await notion(`/v1/pages/${encodeURIComponent(page)}`, { properties }, "PATCH");
}
