import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Draft, Skill, State } from "#skill/shape.ts";

const SCHEMA = `
  create table if not exists skills (
    id       text primary key,
    name     text not null unique,
    state    text not null,
    drafted  integer not null,
    approved integer,
    trouble  text,
    template text not null,
    confirmed integer
  );

  create index if not exists skills_state on skills(state);
`;

type Row = {
  id: string;
  name: string;
  state: string;
  drafted: number;
  approved: number | null;
  trouble: string | null;
  template: string;
  confirmed: number | null;
};

function shaped(row: Row): Skill {
  return {
    ...(JSON.parse(row.template) as Draft),
    id: row.id,
    name: row.name,
    state: row.state as State,
    drafted: row.drafted,
    approved: row.approved ?? undefined,
    confirmed: row.confirmed ?? undefined,
    trouble: row.trouble ?? undefined,
  };
}

/// What Kyuren has taught itself to do, and what standing each of those things has.
///
/// The standing is kept here and nowhere else. Everything that runs a skill reads it back from
/// this store at the moment of the call rather than trusting what it was handed, which is what
/// makes an unapproved skill unrunnable by any route.
export class Skills {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("pragma journal_mode = wal");
    this.db.exec(SCHEMA);
    const columns = this.db.prepare("pragma table_info(skills)").all() as Array<{ name: string }>;
    if (!columns.some((one) => one.name === "confirmed")) this.db.exec("alter table skills add column confirmed integer");
  }

  close(): void {
    this.db.close();
  }

  /// Writes a skill down. It is inert: drafting is not approving, and nothing here can approve.
  draft(draft: Draft, at = Date.now()): Skill {
    const id = randomUUID();
    this.db
      .prepare("insert into skills (id, name, state, drafted, template) values (?, ?, ?, ?, ?)")
      .run(id, draft.name, "pending", at, JSON.stringify(draft));
    return { ...draft, id, state: "pending", drafted: at };
  }

  /// Changes what a skill asks for, and puts it back where every skill starts.
  ///
  /// Approval is of a request, not of a name. Without this, the way past the gate is to have a
  /// harmless skill approved and then quietly rewrite it into another one.
  revise(id: string, draft: Draft, at = Date.now()): Skill | undefined {
    if (!this.find(id)) return undefined;
    this.db
      .prepare(`
        update skills set name = ?, template = ?, state = 'pending',
        drafted = ?, approved = null, trouble = null where id = ?
      `)
      .run(draft.name, JSON.stringify(draft), at, id);
    return this.find(id);
  }

  /// The user said yes to the first call of this approval. One given for an earlier approval, before
  /// the skill was changed and approved again, confirms nothing.
  confirm(id: string, approval: number): void {
    this.db.prepare("update skills set confirmed = ? where id = ? and approved = ?").run(approval, id, approval);
  }

  approve(id: string, at = Date.now()): boolean {
    const found = this.find(id);
    if (!found) return false;
    this.db
      .prepare("update skills set state = 'approved', approved = ?, trouble = null where id = ?")
      .run(at, id);
    return true;
  }

  /// Marks a skill as no longer working, with the reason. A broken skill is not approved any more,
  /// so nothing calls it again until someone has looked at it.
  breaks(id: string, why: string): void {
    this.db
      .prepare("update skills set state = 'broken', trouble = ? where id = ?")
      .run(why.slice(0, 400), id);
  }

  forget(id: string): void {
    this.db.prepare("delete from skills where id = ?").run(id);
  }

  find(id: string): Skill | undefined {
    const row = this.db.prepare("select * from skills where id = ?").get(id) as Row | undefined;
    return row ? shaped(row) : undefined;
  }

  named(name: string): Skill | undefined {
    const row = this.db.prepare("select * from skills where name = ?").get(name) as Row | undefined;
    return row ? shaped(row) : undefined;
  }

  list(state?: State): Skill[] {
    const rows = state
      ? (this.db.prepare("select * from skills where state = ? order by drafted desc").all(state) as Row[])
      : (this.db.prepare("select * from skills order by drafted desc").all() as Row[]);
    return rows.map(shaped);
  }

  names(): string[] {
    const rows = this.db.prepare("select name from skills").all() as Array<{ name: string }>;
    return rows.map((one) => one.name);
  }
}
