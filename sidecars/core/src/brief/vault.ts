import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Digest } from "#brief/digest.ts";
import { merge, noteName, render } from "#brief/note.ts";

/// Days live together in one folder, named for the day, so an Obsidian vault pointed here sees a
/// daily note and nothing it has to be taught about.
export function notePath(vault: string, day: string): string {
  return join(vault, "days", noteName(day));
}

export async function writeNote(
  vault: string,
  summary: Digest,
  read: string[],
): Promise<string> {
  const path = notePath(vault, summary.day);
  await mkdir(dirname(path), { recursive: true });

  const existing = await readFile(path, "utf8").catch(() => undefined);
  await writeFile(path, merge(existing, render(summary, read)), "utf8");
  return path;
}
