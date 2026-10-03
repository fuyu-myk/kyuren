import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Chunk } from "#memory/chunk.ts";

/// The index is derived and disposable. Everything it holds can be rebuilt from the markdown, so
/// it is never the place a fact lives, only the place a fact is quick to find.
const SCHEMA = `
  create table if not exists chunks (
    hash     text primary key,
    text     text not null,
    heading  text not null,
    vector   blob
  );

  create table if not exists placements (
    file   text not null,
    ord    integer not null,
    hash   text not null references chunks(hash),
    primary key (file, ord)
  );

  create index if not exists placements_hash on placements(hash);

  create virtual table if not exists words using fts5(
    hash unindexed, text, tokenize = 'porter unicode61'
  );
`;

export type Held = {
  hash: string;
  text: string;
  heading: string;
  file: string;
};

export class Index {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("pragma journal_mode = wal");
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  /// Which of these are new. Everything else is already embedded and must not be embedded again.
  unknown(hashes: string[]): string[] {
    const known = new Set<string>();
    const ask = this.db.prepare("select hash from chunks where hash = ?");
    for (const hash of hashes) {
      if (ask.get(hash)) known.add(hash);
    }
    return hashes.filter((hash) => !known.has(hash));
  }

  remember(chunk: Chunk, vector: Float32Array | undefined): void {
    this.db
      .prepare("insert or ignore into chunks (hash, text, heading, vector) values (?, ?, ?, ?)")
      .run(chunk.hash, chunk.text, chunk.heading, vector ? Buffer.from(vector.buffer) : null);
    this.db.prepare("insert into words (hash, text) values (?, ?)").run(chunk.hash, chunk.text);
  }

  /// A file's chunks are replaced wholesale. What survives is the chunk rows, which are shared by
  /// content, so rewriting a file re-embeds only what its text actually changed.
  place(file: string, chunks: Chunk[]): void {
    this.db.prepare("delete from placements where file = ?").run(file);
    const put = this.db.prepare("insert into placements (file, ord, hash) values (?, ?, ?)");
    for (const chunk of chunks) put.run(file, chunk.order, chunk.hash);
  }

  /// Forgets where every chunk was, keeping the chunks themselves so nothing is embedded twice.
  clearPlacements(): void {
    this.db.exec("delete from placements");
  }

  forget(file: string): void {
    this.db.prepare("delete from placements where file = ?").run(file);
  }

  /// Chunks no file points at any more, with the rows that only existed for them.
  prune(): number {
    const orphans = this.db
      .prepare("select hash from chunks where hash not in (select hash from placements)")
      .all() as Array<{ hash: string }>;

    for (const { hash } of orphans) {
      this.db.prepare("delete from words where hash = ?").run(hash);
      this.db.prepare("delete from chunks where hash = ?").run(hash);
    }
    return orphans.length;
  }

  vectors(): Array<{ hash: string; vector: Float32Array }> {
    const rows = this.db
      .prepare("select hash, vector from chunks where vector is not null")
      .all() as Array<{ hash: string; vector: Uint8Array }>;

    return rows.map((row) => ({
      hash: row.hash,
      vector: new Float32Array(
        row.vector.buffer,
        row.vector.byteOffset,
        row.vector.byteLength / 4,
      ),
    }));
  }

  byWords(query: string, most: number): string[] {
    const cleaned = query.replace(/[^\p{L}\p{N}\s]/gu, " ").trim();
    if (cleaned === "") return [];

    const rows = this.db
      .prepare("select hash from words where words match ? order by rank limit ?")
      .all(cleaned.split(/\s+/).map((word) => `"${word}"`).join(" OR "), most) as Array<{ hash: string }>;

    return rows.map((row) => row.hash);
  }

  held(hashes: string[]): Held[] {
    return hashes.flatMap((hash) => {
      const row = this.db
        .prepare(`select c.hash, c.text, c.heading,
                         coalesce((select file from placements where hash = c.hash limit 1), '') as file
                  from chunks c where c.hash = ?`)
        .get(hash) as Held | undefined;
      return row ? [row] : [];
    });
  }

  /// Every chunk with a file that holds it, for work that reads the whole vault at once.
  everything(): Held[] {
    return this.db
      .prepare(`select c.hash, c.text, c.heading,
                       coalesce((select file from placements where hash = c.hash limit 1), '') as file
                from chunks c`)
      .all() as Held[];
  }

  counts(): { chunks: number; files: number; embedded: number } {
    const one = (sql: string) => (this.db.prepare(sql).get() as { n: number }).n;
    return {
      chunks: one("select count(*) as n from chunks"),
      files: one("select count(distinct file) as n from placements"),
      embedded: one("select count(*) as n from chunks where vector is not null"),
    };
  }
}
