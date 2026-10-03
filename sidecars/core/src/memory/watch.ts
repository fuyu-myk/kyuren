import { watch, type FSWatcher } from "node:fs";
import { join, sep } from "node:path";

/// How long to wait for an editor to finish. A save is rarely one event: editors write, rename and
/// touch, and reindexing on the first of those reads a half-written file.
const SETTLE = 300;

const KEPT = /\.(md|markdown)$/i;
const SKIPPED = ["/.git/", "/.obsidian/", "/.trash/", "/.index/"];

export type Watcher = { stop: () => void };

/// Watches the vault for edits made anywhere, by anything. The notes are files first and Kyuren's
/// second, so a change made in another editor has to count the same as one made here.
export function watchVault(
  vault: string,
  onChanged: (files: string[]) => void,
): Watcher {
  const pending = new Set<string>();
  let timer: NodeJS.Timeout | undefined;

  const settle = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const changed = [...pending];
      pending.clear();
      if (changed.length > 0) onChanged(changed);
    }, SETTLE);
  };

  let watcher: FSWatcher | undefined;
  try {
    watcher = watch(vault, { recursive: true }, (_event, name) => {
      if (!name) return;
      // Paths arrive relative to the folder being watched. Notes are addressed by their full path,
      // because several vaults are open at once and each may hold a note of the same name.
      if (!KEPT.test(name)) return;
      if (SKIPPED.some((part) => `${sep}${name}`.includes(part))) return;
      pending.add(join(vault, name));
      settle();
    });
  } catch {
    // A vault that does not exist yet is watched once it does, by whoever creates it.
  }

  return {
    stop: () => {
      if (timer) clearTimeout(timer);
      watcher?.close();
    },
  };
}
