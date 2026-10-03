import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Place } from "#permission/action.ts";
import { MODES, type Mode } from "#memory/vaults.ts";

const root = process.env.KYUREN_HOME ?? join(homedir(), ".kyuren");
const listed = join(root, "notion.json");

export type Database = {
  id: string;
  title: string;
  mode: Mode;
};

/// A database Kyuren has found but not been told about is read only, the same as a folder someone
/// already keeps. Sharing a database with the integration says it may be read, not written.
export const DEFAULT_MODE: Mode = "read";

/// How a Notion database is addressed when deciding what may be done to it. The same shape as a
/// folder, so one rule covers both and neither needs a special case.
export function addressOf(id: string): string {
  return `notion://data-source/${id}`;
}

export function pageAddress(databaseId: string, pageId: string): string {
  return `${addressOf(databaseId)}/${pageId}`;
}

function held(): Database[] {
  try {
    const parsed = JSON.parse(readFileSync(listed, "utf8")) as { databases?: unknown };
    if (!Array.isArray(parsed.databases)) return [];
    return parsed.databases.flatMap((one): Database[] => {
      const entry = one as Partial<Database>;
      if (typeof entry.id !== "string") return [];
      return [{
        id: entry.id,
        title: typeof entry.title === "string" ? entry.title : entry.id,
        mode: MODES.find((mode) => mode === entry.mode) ?? DEFAULT_MODE,
      }];
    });
  } catch {
    return [];
  }
}

export function databases(): Database[] {
  return held();
}

function save(all: Database[]): Database[] {
  mkdirSync(dirname(listed), { recursive: true });
  writeFileSync(listed, `${JSON.stringify({ databases: all }, null, 2)}\n`, "utf8");
  return held();
}

/// Records what was found without changing anything already decided, so discovering a workspace
/// again never quietly re-opens a database the user closed.
export function remember(found: Array<{ id: string; title: string }>): Database[] {
  const known = new Map(held().map((one) => [one.id, one]));
  for (const one of found) {
    const already = known.get(one.id);
    known.set(one.id, { id: one.id, title: one.title, mode: already?.mode ?? DEFAULT_MODE });
  }
  return save([...known.values()]);
}

export function setMode(id: string, mode: Mode): Database[] {
  const all = held();
  if (!all.some((one) => one.id === id)) throw new Error(`${id} is not a known database`);
  return save(all.map((one) => (one.id === id ? { ...one, mode } : one)));
}

export function places(): Place[] {
  return held().map((one) => ({ path: addressOf(one.id), mode: one.mode }));
}
