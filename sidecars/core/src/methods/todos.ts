import { readingAction } from "#connect/read.ts";
import { tokenHeld } from "#connect/notion/api.ts";
import { chooseTodos, databases, pageAddress, remember, todosDatabase, type Database } from "#connect/notion/places.ts";
import { notionSource } from "#connect/notion/source.ts";
import { addingOf, addTodo, databaseShape, markTodo, openTodos, type Adding, type Shape, type Todo } from "#connect/notion/todos.ts";
import { databasesAvailable } from "#connect/notion/write.ts";
import type { Gate } from "#permission/gate.ts";

/// The todos as the island shows them: the database they are kept in, what it can hold, and those
/// not yet done; or, with none, why.
export type Listed = {
  database?: string;
  fields?: { date: boolean; priority: boolean; done: boolean };
  todos: Todo[];
  missing?: "unchosen" | "unconnected" | "refused" | "unshaped";
};

export type TodoNotion = {
  connected: () => boolean;
  available: () => Promise<Array<{ id: string; title: string }>>;
  shape: (id: string) => Promise<{ title: string; shape?: Shape }>;
  open: (id: string, shape: Shape) => Promise<Todo[]>;
  add: (id: string, shape: Shape, adding: Adding) => Promise<void>;
  mark: (page: string, shape: Shape, done: boolean) => Promise<void>;
};

export type TodoPlaces = {
  chosen: () => Database | undefined;
  choose: (id: string | null) => Database[];
  remember: (found: Array<{ id: string; title: string }>) => Database[];
  known: () => Database[];
};

const NOTION: TodoNotion = { connected: tokenHeld, available: databasesAvailable, shape: databaseShape, open: openTodos, add: addTodo, mark: markTodo };
const PLACES: TodoPlaces = { chosen: todosDatabase, choose: chooseTodos, remember, known: databases };

/// A Notion page's id as Notion gives it, and nothing that could reach another address.
const PAGE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

/// The todo list, kept in the Notion database chosen for it in settings. Reading it is reading
/// Notion, allowed when the database was chosen; writing is judged by where it lands, which only
/// the chosen database allows.
export function todoHandlers(gate: Gate, told: (listed: Listed) => void, notion: TodoNotion = NOTION, places: TodoPlaces = PLACES) {
  const chosen = (): Database => {
    const database = places.chosen();
    if (!database) throw new Error("choose a Notion database for todos in settings first");
    return database;
  };

  const shaped = async (database: Database): Promise<{ title: string; shape: Shape }> => {
    const { title, shape } = await notion.shape(database.id);
    if (!shape) throw new Error(`${title} has no title to write a todo in`);
    return { title, shape };
  };

  const writable = (database: Database, page: string, carrying: string): void => {
    const verdict = gate.decide({ tool: "todos", effect: "write", target: pageAddress(database.id, page), carrying }).verdict;
    if (verdict !== "allow") throw new Error(`Kyuren may not write to ${database.title}; choose it for todos in settings`);
  };

  const list = async (): Promise<Listed> => {
    const database = places.chosen();
    if (!database) return { todos: [], missing: "unchosen" };
    if (!notion.connected()) return { todos: [], missing: "unconnected" };
    if (gate.decide(readingAction(notionSource)).verdict !== "allow") return { todos: [], missing: "refused" };
    const { title, shape } = await notion.shape(database.id);
    if (!shape) return { database: title, todos: [], missing: "unshaped" };
    return {
      database: title,
      fields: { date: shape.date !== undefined, priority: shape.priority !== undefined, done: shape.status !== undefined || shape.checkbox !== undefined },
      todos: await notion.open(database.id, shape),
    };
  };

  const changed = async (): Promise<Listed> => {
    const listed = await list();
    told(listed);
    return listed;
  };

  const settings = (databasesFound: Database[]) => ({
    connected: notion.connected(),
    databases: databasesFound.map(({ id, title }) => ({ id, title })),
    ...(places.chosen() ? { chosen: places.chosen()!.id } : {}),
  });

  return {
    "todos.list": async () => list(),

    "todos.add": async (params: Record<string, unknown>) => {
      const adding = addingOf(params);
      const database = chosen();
      writable(database, "new", adding.text);
      const { shape } = await shaped(database);
      await notion.add(database.id, shape, adding);
      return changed();
    },

    "todos.tick": async (params: Record<string, unknown>) => {
      if (typeof params.id !== "string" || !PAGE.test(params.id)) throw new Error("that is not a todo on the list");
      if (typeof params.done !== "boolean") throw new Error("say whether it is done, true or false");
      const database = chosen();
      writable(database, params.id, params.done ? "done" : "not done");
      const { shape } = await shaped(database);
      await notion.mark(params.id, shape, params.done);
      return changed();
    },

    /// What settings offers: whether Notion is connected, the databases shared with Kyuren's
    /// integration, found afresh, and which one holds the todos.
    "notion.todos": async () => {
      const found = notion.connected() ? await notion.available().catch(() => undefined) : undefined;
      return settings(found ? places.remember(found) : places.known());
    },

    /// Choosing a database for todos, or none. Chosen, it may be written, and Notion may be read
    /// for it, as the user said in choosing it.
    "notion.todos.choose": async (params: Record<string, unknown>) => {
      const id = params.id;
      if (id !== null && (typeof id !== "string" || id.trim() === "")) throw new Error("say which database, or none");
      const after = places.choose(id);
      if (id !== null) gate.remember(readingAction(notionSource), "allow");
      return settings(after);
    },
  };
}
