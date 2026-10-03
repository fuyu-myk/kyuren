import { key } from "#entity/names.ts";
import type { Entity } from "#entity/resolve.ts";
import type { Ranked } from "#memory/fuse.ts";

/// Which of the entities a question names, by any way it has been written, as whole words. Only
/// something written more than one way is worth naming: the notes that say "P. Holst" are what a
/// question about Petra would otherwise miss, while a thing with one name is found by that word.
export function mentioned(question: string, entities: Entity[]): Entity[] {
  const asked = ` ${key(question).replace(/[^\p{L}\p{N}\s.]/gu, " ").replace(/\s+/g, " ").trim()} `;
  return entities.filter(
    (one) =>
      one.aliases.length > 1
      && [...one.aliases.map(key), ...one.parts].some((form) => asked.includes(` ${form} `)),
  );
}

/// Every chunk that mentions any of these, the ones that mention more of them first.
export function chunksAbout(named: Entity[]): Ranked[] {
  const count = new Map<string, number>();
  for (const one of named) {
    for (const hash of one.chunks) count.set(hash, (count.get(hash) ?? 0) + 1);
  }
  return [...count]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
