import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

/// Anything a person might reasonably keep notes in. Everything else in the folder is left alone,
/// including whatever an editor writes beside the notes.
const KEPT = /\.(md|markdown)$/i;
const SKIPPED = new Set([".git", ".obsidian", ".trash", "node_modules"]);

/// Full paths, not names relative to one folder. Several vaults are open at once and two of them
/// may each hold a "reading.md".
export async function notesIn(vault: string): Promise<string[]> {
  const found: string[] = [];

  async function walk(here: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(here, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".") && !KEPT.test(entry.name)) {
        if (SKIPPED.has(entry.name) || entry.isDirectory()) continue;
      }
      const path = join(here, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED.has(entry.name)) await walk(path);
      } else if (KEPT.test(entry.name)) {
        found.push(path);
      }
    }
  }

  await walk(vault);
  return found.sort();
}

export async function readNote(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return undefined;
  }
}

export async function changedAt(file: string): Promise<number | undefined> {
  try {
    return (await stat(file)).mtimeMs;
  } catch {
    return undefined;
  }
}
