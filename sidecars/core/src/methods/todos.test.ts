import assert from "node:assert/strict";
import { test } from "node:test";
import { readingAction } from "#connect/read.ts";
import { notionSource } from "#connect/notion/source.ts";
import { addressOf, type Database } from "#connect/notion/places.ts";
import type { Adding, Editing, Shape, Todo } from "#connect/notion/todos.ts";
import { todoHandlers, type Listed, type TodoNotion, type TodoPlaces } from "#methods/todos.ts";
import { Gate } from "#permission/gate.ts";

const PAGE = "0b8c1f2e-1111-4222-8333-944455556666";
const shape: Shape = { title: "Name", date: "Due", status: { property: "State", done: "Done", open: "Not started", finished: ["Done"] } };

function world(options: { chosen?: string; mode?: Database["mode"]; connected?: boolean; allowed?: boolean } = {}) {
  const known: Database[] = [{ id: "db", title: "Tasks", mode: options.mode ?? "write" }, { id: "other", title: "Reading", mode: "read" }];
  let chosen = options.chosen;
  const todos: Todo[] = [{ id: PAGE, text: "Book the dentist", done: false }];
  const added: Adding[] = [];
  const marked: Array<[string, boolean]> = [];
  const edited: Array<[string, Editing]> = [];
  const told: Listed[] = [];
  const gate = new Gate(() => known.map((one) => ({ path: addressOf(one.id), mode: one.mode })), () => undefined);
  if (options.allowed !== false) gate.remember(readingAction(notionSource), "allow");
  const notion: TodoNotion = {
    connected: () => options.connected !== false,
    available: async () => known.map(({ id, title }) => ({ id, title })),
    shape: async () => ({ title: "Tasks", shape }),
    open: async () => todos,
    add: async (_id, _shape, adding) => void added.push(adding),
    mark: async (page, _shape, done) => void marked.push([page, done]),
    edit: async (page, _shape, editing) => void edited.push([page, editing]),
  };
  const places: TodoPlaces = {
    chosen: () => known.find((one) => one.id === chosen),
    choose: (id) => {
      chosen = id ?? undefined;
      return known;
    },
    remember: () => known,
    known: () => known,
  };
  const handlers = todoHandlers(gate, (listed) => told.push(listed), notion, places);
  return { handlers, added, marked, edited, told, gate };
}

test("with no database chosen, or Notion not connected, the island is told why there are no todos", async () => {
  assert.deepEqual(await world().handlers["todos.list"](), { todos: [], missing: "unchosen" });
  assert.deepEqual(await world({ chosen: "db", connected: false }).handlers["todos.list"](), { todos: [], missing: "unconnected" });
  assert.deepEqual(await world({ chosen: "db", allowed: false }).handlers["todos.list"](), { todos: [], missing: "refused" });
});

test("the chosen database's open todos are listed, with what it can hold", async () => {
  assert.deepEqual(await world({ chosen: "db" }).handlers["todos.list"](), {
    database: "Tasks",
    fields: { date: true, priority: false, done: true },
    todos: [{ id: PAGE, text: "Book the dentist", done: false }],
  });
});

test("a todo is added and ticked in the chosen database, and the island told the list", async () => {
  const { handlers, added, marked, told } = world({ chosen: "db" });
  await handlers["todos.add"]({ text: " Book the dentist ", date: "2026-10-30", time: "14:00" });
  await handlers["todos.tick"]({ id: PAGE, done: true });
  assert.deepEqual(added, [{ text: "Book the dentist", date: "2026-10-30", time: "14:00" }]);
  assert.deepEqual(marked, [[PAGE, true]]);
  assert.equal(told.length, 2);
});

test("nothing is written where Kyuren may not write, nor anything not asked for properly", async () => {
  const closed = world({ chosen: "db", mode: "read" });
  await assert.rejects(closed.handlers["todos.add"]({ text: "Read" }), /may not write/);
  await assert.rejects(closed.handlers["todos.tick"]({ id: PAGE, done: true }), /may not write/);
  assert.deepEqual([closed.added, closed.marked], [[], []]);
  const open = world({ chosen: "db" });
  await assert.rejects(open.handlers["todos.add"]({ text: "x", date: "tomorrow" }), /date/);
  await assert.rejects(open.handlers["todos.tick"]({ id: "../p1", done: true }), /todo/);
  await assert.rejects(open.handlers["todos.tick"]({ id: PAGE, done: "yes" }), /done/);
  await assert.rejects(world().handlers["todos.add"]({ text: "Read" }), /choose/);
});

test("the databases shared with Kyuren are listed for settings, and choosing one allows reading Notion", async () => {
  const { handlers, gate } = world({ allowed: false });
  assert.deepEqual(await handlers["notion.todos"](), { connected: true, databases: [{ id: "db", title: "Tasks" }, { id: "other", title: "Reading" }] });
  assert.deepEqual(await handlers["notion.todos.choose"]({ id: "db" }), { connected: true, databases: [{ id: "db", title: "Tasks" }, { id: "other", title: "Reading" }], chosen: "db" });
  assert.equal(gate.decide(readingAction(notionSource)).verdict, "allow");
  await assert.rejects(handlers["notion.todos.choose"]({ id: 7 }), /database/);
});

test("a todo is edited in the chosen database with only what changes, and nowhere Kyuren may not write", async () => {
  const { handlers, edited, told } = world({ chosen: "db" });
  await handlers["todos.edit"]({ id: PAGE, text: " Book the dentist for Friday ", date: "2026-10-30", time: null, priority: "" });
  assert.deepEqual(edited, [[PAGE, { text: "Book the dentist for Friday", due: { date: "2026-10-30" }, priority: null }]]);
  assert.equal(told.length, 1);
  const closed = world({ chosen: "db", mode: "read" });
  await assert.rejects(closed.handlers["todos.edit"]({ id: PAGE, text: "x" }), /may not write/);
  await assert.rejects(world({ chosen: "db" }).handlers["todos.edit"]({ id: "../x", text: "x" }), /todo/);
  assert.deepEqual(closed.edited, []);
});

