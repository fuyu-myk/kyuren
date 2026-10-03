import { candidates, key } from "#entity/names.ts";
import { ordinaryIn } from "#entity/parts.ts";
import { group, merge, onlyProven, type Entity, type Seen } from "#entity/resolve.ts";
import type { Held } from "#memory/index.ts";

export type { Entity };

/// Who and what the notes are about, found and joined by how they are written.
export function gatherEntities(chunks: Held[]): Entity[] {
  const seen: Seen[] = chunks.flatMap((chunk) =>
    candidates(chunk.text).map((one) => ({
      name: one.name,
      file: chunk.file,
      hash: chunk.hash,
      proven: one.proven,
      whole: one.whole,
    })),
  );
  const ordinary = new Set(chunks.flatMap((chunk) => ordinaryIn(chunk.text)));
  return onlyProven(merge(group(seen))).map((one) => ({
    ...one,
    parts: one.parts.filter((part) => !ordinary.has(part)),
  }));
}

export function mentionsOf(name: string, entities: Entity[]): Entity | undefined {
  const wanted = key(name);
  return entities.find(
    (one) => key(one.name) === wanted || one.aliases.some((alias) => key(alias) === wanted),
  );
}
