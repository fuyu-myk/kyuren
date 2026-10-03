import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Route } from "#model/route.ts";
import type { Pane } from "#session/panes.ts";

/// Sessions are not derived from anything, so unlike the memory index this is where they live. It
/// is the one store in Kyuren that cannot be rebuilt if it is lost.
const SCHEMA = `
  create table if not exists sessions (
    id      text primary key,
    pane    text not null,
    title   text not null,
    started integer not null,
    touched integer not null,
    seq     integer not null
  );

  create index if not exists sessions_seq on sessions(seq desc);

  create table if not exists turns (
    session text not null references sessions(id) on delete cascade,
    ord     integer not null,
    role    text not null,
    text    text not null,
    at      integer not null,
    primary key (session, ord)
  );
`;

/// Columns that came after the first shape of the store. Each is added where it is missing, so a
/// store made before it opens as well as one made after, and filled in where what it says can be
/// worked out from what is already there.
const ADDED: Array<[table: string, column: string, kind: string, filled?: string]> = [
  ["turns", "model", "text"],
  ["turns", "route", "text"],
  ["turns", "input", "integer"],
  ["turns", "output", "integer"],
  ["sessions", "preferred", "text"],
  // A conversation from before the mark may quote the user's notes in what it said, so one that
  // said anything is taken to hold them.
  ["sessions", "exposed", "integer", "update sessions set exposed = 1 where id in (select session from turns where role = 'assistant')"],
];

export type Role = "user" | "assistant";

/// What answered a turn and how much it read, kept with the turn so that a conversation opened
/// again can say what it cost.
export type Answered = {
  model: string;
  route: Route;
  usage?: { input: number; output: number };
};

export type Turn = {
  role: Role;
  text: string;
  at: number;
  by?: Answered;
};

export type Session = {
  id: string;
  pane: Pane;
  title: string;
  started: number;
  /// When something last happened in it, which is what a list of sessions shows.
  touched: number;
  turns: number;
  /// The route the user chose for this conversation. None means the router decides.
  preferred?: Route;
  /// Whether it has read the user's notes, after which nothing it sends off the machine goes
  /// without a question.
  exposed?: true;
};

type Row = {
  id: string;
  pane: string;
  title: string;
  started: number;
  touched: number;
  turns: number;
  preferred: string | null;
  exposed: number | null;
};

type TurnRow = {
  role: string;
  text: string;
  at: number;
  model: string | null;
  route: string | null;
  input: number | null;
  output: number | null;
};

const HELD = 60;

function shaped(row: Row): Session {
  return {
    id: row.id,
    pane: row.pane as Pane,
    title: row.title,
    started: row.started,
    touched: row.touched,
    turns: row.turns,
    ...(row.preferred ? { preferred: row.preferred as Route } : {}),
    ...(row.exposed ? { exposed: true as const } : {}),
  };
}

function turnShaped(row: TurnRow): Turn {
  const by: Answered | undefined =
    row.model && row.route
      ? {
          model: row.model,
          route: row.route as Route,
          ...(row.input !== null ? { usage: { input: row.input, output: row.output ?? 0 } } : {}),
        }
      : undefined;
  return { role: row.role as Role, text: row.text, at: row.at, ...(by ? { by } : {}) };
}

export class Sessions {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("pragma journal_mode = wal");
    this.db.exec("pragma foreign_keys = on");
    this.db.exec(SCHEMA);
    this.grow();
  }

  private grow(): void {
    for (const [table, column, kind, filled] of ADDED) {
      const columns = this.db.prepare(`pragma table_info(${table})`).all() as Array<{ name: string }>;
      if (!columns.some((one) => one.name === column)) {
        // Together or not at all, so a store is never left with the column and without what it says.
        this.db.exec("begin");
        try {
          this.db.exec(`alter table ${table} add column ${column} ${kind}`);
          if (filled) this.db.exec(filled);
          this.db.exec("commit");
        } catch (failure) {
          this.db.exec("rollback");
          throw failure;
        }
      }
    }
  }

  close(): void {
    this.db.close();
  }

  /// The next place in the order of things. Two sessions touched in the same millisecond are
  /// still one after the other, and a clock that steps backwards does not reorder the list.
  private next(): number {
    const row = this.db.prepare("select coalesce(max(seq), 0) + 1 as seq from sessions").get() as {
      seq: number;
    };
    return row.seq;
  }

  start(pane: Pane, title: string, at = Date.now()): Session {
    const id = randomUUID();
    const named = title.slice(0, HELD);
    this.db
      .prepare(`
        insert into sessions (id, pane, title, started, touched, seq) values (?, ?, ?, ?, ?, ?)
      `)
      .run(id, pane, named, at, at, this.next());
    return { id, pane, title: named, started: at, touched: at, turns: 0 };
  }

  /// Adds one turn and marks the session as the most recent thing to have happened.
  remember(id: string, role: Role, text: string, at = Date.now(), by?: Answered): void {
    const next = this.db
      .prepare("select coalesce(max(ord), -1) + 1 as ord from turns where session = ?")
      .get(id) as { ord: number };

    this.db
      .prepare(`
        insert into turns (session, ord, role, text, at, model, route, input, output)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        next.ord,
        role,
        text,
        at,
        by?.model ?? null,
        by?.route ?? null,
        by?.usage?.input ?? null,
        by?.usage?.output ?? null,
      );
    this.db
      .prepare("update sessions set touched = ?, seq = ? where id = ?")
      .run(at, this.next(), id);
  }

  read(id: string): Turn[] {
    const rows = this.db
      .prepare(
        "select role, text, at, model, route, input, output from turns where session = ? order by ord",
      )
      .all(id) as TurnRow[];
    return rows.map(turnShaped);
  }

  /// The route the user chose for a session, or none, meaning the router decides.
  prefer(id: string, route: Route | undefined): void {
    this.db.prepare("update sessions set preferred = ? where id = ?").run(route ?? null, id);
  }

  expose(id: string): void {
    this.db.prepare("update sessions set exposed = 1 where id = ?").run(id);
  }

  find(id: string): Session | undefined {
    const row = this.db
      .prepare(`
        select s.*, (select count(*) from turns where session = s.id) as turns
        from sessions s where s.id = ?
      `)
      .get(id) as Row | undefined;
    return row ? shaped(row) : undefined;
  }

  /// Every session, most recently touched first, whichever pane it belongs to.
  list(limit = 50): Session[] {
    const rows = this.db
      .prepare(`
        select s.*, (select count(*) from turns where session = s.id) as turns
        from sessions s order by s.seq desc limit ?
      `)
      .all(limit) as Row[];
    return rows.map(shaped);
  }

  inPane(pane: Pane, limit = 50): Session[] {
    const rows = this.db
      .prepare(`
        select s.*, (select count(*) from turns where session = s.id) as turns
        from sessions s where s.pane = ? order by s.seq desc limit ?
      `)
      .all(pane, limit) as Row[];
    return rows.map(shaped);
  }

  rename(id: string, title: string): void {
    this.db.prepare("update sessions set title = ? where id = ?").run(title.slice(0, HELD), id);
  }

  forget(id: string): void {
    this.db.prepare("delete from turns where session = ?").run(id);
    this.db.prepare("delete from sessions where id = ?").run(id);
  }
}
