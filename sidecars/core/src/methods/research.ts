import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SLUG = /^[\p{L}\p{N}-]{1,64}$/u;

/// What research has produced: the notes under the vault's research folder, newest first, and
/// any one of them by its file name.
export function researchHandlers(vault: string) {
  const folder = join(vault, "research");

  return {
    "research.notes": async () => {
      let files: string[];
      try {
        files = readdirSync(folder).filter((one) => one.endsWith(".md"));
      } catch {
        return { notes: [] };
      }
      const notes = files.map((file) => {
        const path = join(folder, file);
        const text = readFileSync(path, "utf8");
        const title = /^#\s+(.+)$/m.exec(text)?.[1]?.trim() ?? file.slice(0, -3);
        return { slug: file.slice(0, -3), title, at: statSync(path).mtime.toISOString() };
      });
      return { notes: notes.sort((a, b) => b.at.localeCompare(a.at)) };
    },

    "research.read": async (params: Record<string, unknown>) => {
      const slug = params.slug;
      if (typeof slug !== "string" || !SLUG.test(slug)) throw new Error("research.read needs the name of a note");
      return { slug, text: readFileSync(join(folder, `${slug}.md`), "utf8") };
    },
  };
}
