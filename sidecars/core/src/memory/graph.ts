import { basename, sep } from "node:path";
import type { Entity } from "#entity/gather.ts";
import type { Held } from "#memory/index.ts";

export type GraphNode = {
  id: string;
  label: string;
  layer: "memory" | "reasoning" | "capability" | "connected";
  kind: "note" | "entity" | "tool" | "step";
  /// How much this node matters, used for how large it is drawn.
  weight: number;
};

export type GraphLink = {
  from: string;
  to: string;
  strength: number;
};

export type Graph = {
  nodes: GraphNode[];
  links: GraphLink[];
};

function noteId(file: string): string {
  return `note:${file}`;
}

/// How much the mind can carry and still turn: every note, and as many of the things they are
/// about as fit, those joining the most notes first.
const ROOM = 1000;

/// The vault as a graph: a note for every file, an entity for everyone and everything the notes are
/// about, and a link wherever one is mentioned in the other. Notes are not linked to each other
/// directly; what joins two notes is the thing they both talk about.
///
/// Notes outside Kyuren's own vault are the connected layer. Someone is memory once they appear
/// in one of Kyuren's own notes, wherever else they appear: a person is not filed under a folder.
export function memoryGraph(chunks: Held[], entities: Entity[], own?: string): Graph {
  const inside = (file: string): boolean =>
    own === undefined || file === own || file.startsWith(own.endsWith(sep) ? own : `${own}${sep}`);

  const files = new Map<string, number>();
  for (const chunk of chunks) {
    if (chunk.file === "") continue;
    files.set(chunk.file, (files.get(chunk.file) ?? 0) + 1);
  }

  const nodes: GraphNode[] = [...files].map(([file, chunkCount]) => ({
    id: noteId(file),
    label: basename(file).replace(/\.(md|markdown)$/i, ""),
    layer: inside(file) ? ("memory" as const) : ("connected" as const),
    kind: "note" as const,
    weight: chunkCount,
  }));

  const links: GraphLink[] = [];

  // What my own notes mention is always drawn. From elsewhere, only what joins two notes: a
  // thing in a single note joins nothing, and a vault of a few hundred notes names thousands.
  const mine = entities.filter((entity) => entity.files.some(inside));
  const joining = entities
    .filter((entity) => !entity.files.some(inside))
    .map((entity) => ({ entity, held: entity.files.filter((file) => files.has(file)).length }))
    .filter((one) => one.held >= 2)
    .sort((a, b) => b.held - a.held || b.entity.mentions - a.entity.mentions)
    .slice(0, Math.max(0, ROOM - files.size - mine.length))
    .map((one) => one.entity);

  for (const entity of [...mine, ...joining]) {
    const id = `entity:${entity.name.toLowerCase()}`;
    nodes.push({
      id,
      label: entity.name,
      layer: entity.files.some(inside) ? "memory" : "connected",
      kind: "entity",
      weight: entity.mentions,
    });

    for (const file of entity.files) {
      if (!files.has(file)) continue;
      links.push({ from: id, to: noteId(file), strength: 1 });
    }
  }

  return { nodes, links };
}
