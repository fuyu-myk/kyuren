import { readdir } from "node:fs/promises";
import { join } from "node:path";

const dashed = (name: string) => name.replace(/[^A-Za-z0-9]/g, "-");

/// Claude Code names a project's folder after its path with everything but letters and digits made
/// a dash, which
/// reading alone cannot undo: "my-project" and "my/project" come out the same. It is undone by
/// walking the disk from the top, taking at each step a folder the rest of the name begins with,
/// the longest first.
export async function folderOf(encoded: string): Promise<string | undefined> {
  // pi wraps the path in two dashes either side; Claude Code leaves the one the root slash gives.
  return walk("/", encoded.replace(/^-+/, "").replace(/-+$/, ""));
}

async function walk(at: string, rest: string): Promise<string | undefined> {
  if (rest === "") return at;
  const entries = await readdir(at, { withFileTypes: true }).catch(() => []);
  const fits = entries
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => entry.name)
    .filter((name) => rest === dashed(name) || rest.startsWith(`${dashed(name)}-`))
    .sort((a, b) => b.length - a.length);
  for (const name of fits) {
    const after = rest === dashed(name) ? "" : rest.slice(dashed(name).length + 1);
    const found = await walk(join(at, name), after);
    if (found) return found;
  }
  return undefined;
}
