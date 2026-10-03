import { readdir } from "node:fs/promises";
import { join } from "node:path";

/// Folders that are never a project of their own: what a project was built from or built into.
const PASSED = new Set([
  "node_modules",
  "target",
  "dist",
  "build",
  "vendor",
  "Pods",
  ".venv",
  "venv",
]);

const DEEP = 3;

/// Every repository under a folder.
///
/// A repository inside a repository is not looked into: a vendored copy belongs to the thing that
/// vendored it rather than being a project of its own.
export async function repositories(root: string, depth = DEEP): Promise<string[]> {
  const found: string[] = [];

  async function look(where: string, left: number): Promise<void> {
    let entries;
    try {
      entries = await readdir(where, { withFileTypes: true });
    } catch {
      return;
    }

    if (entries.some((one) => one.name === ".git")) {
      found.push(where);
      return;
    }
    if (left <= 0) return;

    for (const one of entries) {
      if (!one.isDirectory()) continue;
      if (one.name.startsWith(".") || PASSED.has(one.name)) continue;
      await look(join(where, one.name), left - 1);
    }
  }

  await look(root, depth);
  return found.sort();
}
