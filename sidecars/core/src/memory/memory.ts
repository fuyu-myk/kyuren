import { gatherEntities, type Entity } from "#entity/gather.ts";
import { chunksAbout, mentioned } from "#entity/mention.ts";
import { memoryGraph, type Graph } from "#memory/graph.ts";
import { chunk } from "#memory/chunk.ts";
import { ollama, type Embedder } from "#memory/embed.ts";
import { cosine, fuse } from "#memory/fuse.ts";
import { Index, type Held } from "#memory/index.ts";
import { frontmatter } from "#memory/frontmatter.ts";
import { notesIn, readNote } from "#memory/vault.ts";

export type Recalled = Held & { score: number };

export type Indexed = {
  files: number;
  chunks: number;
  embedded: number;
  tookMs: number;
};

/// How many each search offers before they are fused. Wider than what is returned, because a
/// result the other search agrees with can be some way down either list.
const CONSIDER = 30;

export class Memory {
  private readonly index: Index;
  private readonly where: () => string[];
  private readonly embedder: Embedder;
  private entitiesHeld: Entity[] | undefined;
  private entitiesAt = "";

  /// Given the vaults each time rather than once, so connecting a folder takes effect without
  /// anything being rebuilt around it.
  constructor(where: () => string[], indexPath: string, embedder: Embedder = ollama) {
    this.where = where;
    this.index = new Index(indexPath);
    this.embedder = embedder;
  }

  close(): void {
    this.index.close();
  }

  counts(): ReturnType<Index["counts"]> {
    return this.index.counts();
  }

  /// Returns how many chunks were embedded, which is how re-embedding only what changed is shown.
  async learn(file: string): Promise<number> {
    const markdown = await readNote(file);
    if (markdown === undefined) {
      this.index.forget(file);
      this.index.prune();
      return 0;
    }

    // Frontmatter is a note's filing, not its content. Indexed as prose it competes with what the
    // note actually says.
    const chunks = chunk(frontmatter(markdown).body);
    const missing = new Set(this.index.unknown(chunks.map((one) => one.hash)));
    const fresh = chunks.filter((one) => missing.has(one.hash));

    if (fresh.length > 0) {
      const vectors = await this.embedder.notes(fresh.map((one) => one.text));
      fresh.forEach((one, at) => this.index.remember(one, vectors[at]));
    }

    this.index.place(file, chunks);
    this.index.prune();
    return fresh.length;
  }

  async learnEverything(): Promise<Indexed> {
    const began = performance.now();
    let embedded = 0;
    for (const vault of this.where()) {
      for (const file of await notesIn(vault)) embedded += await this.learn(file);
    }

    const counts = this.index.counts();
    return {
      files: counts.files,
      chunks: counts.chunks,
      embedded,
      tookMs: Math.round(performance.now() - began),
    };
  }

  /// Starts again from what the vaults now hold. Used when a vault is disconnected, since its
  /// notes must stop being recalled without every other note being embedded again.
  async relearn(): Promise<Indexed> {
    this.index.clearPlacements();
    const built = await this.learnEverything();
    // Pruned here and not only as files are learnt, so a folder that was taken away leaves no
    // text behind even when nothing else is there to be learnt.
    this.index.prune();
    return { ...built, chunks: this.index.counts().chunks };
  }

  forget(file: string): void {
    this.index.forget(file);
    this.index.prune();
  }

  /// Who and what the notes are about. Recomputed when the notes have changed and not otherwise,
  /// because it reads every chunk in the vault.
  entities(): Entity[] {
    const counts = this.index.counts();
    const stamp = `${counts.chunks}:${counts.files}`;
    if (this.entitiesAt === stamp && this.entitiesHeld) return this.entitiesHeld;

    this.entitiesHeld = gatherEntities(this.index.everything());
    this.entitiesAt = stamp;
    return this.entitiesHeld;
  }

  /// The vaults drawn as a graph, for the layers of the mind that are what Kyuren remembers.
  graph(own?: string): Graph {
    return memoryGraph(this.index.everything(), this.entities(), own);
  }

  /// Who or what a question names, among the things written more than one way.
  named(question: string): Entity[] {
    return mentioned(question, this.entities());
  }

  /// Three searches, fused. Meaning alone misses a name it has never seen; words alone miss a
  /// question asked in different words than the note was written in; and both miss a note that
  /// writes the person asked about another way, which is what naming them catches.
  async recall(question: string, most = 5): Promise<Recalled[]> {
    const byWords = this.index.byWords(question, CONSIDER).map((hash, at) => ({
      id: hash,
      score: 1 / (at + 1),
    }));
    const byName = chunksAbout(this.named(question)).slice(0, CONSIDER);

    let byMeaning: Array<{ id: string; score: number }> = [];
    try {
      const asked = await this.embedder.question(question);
      if (asked) {
        byMeaning = this.index
          .vectors()
          .map(({ hash, vector }) => ({ id: hash, score: cosine(asked, vector) }))
          .sort((a, b) => b.score - a.score)
          .slice(0, CONSIDER);
      }
    } catch {
      // Without the embedder there is still keyword search, which is worse but not nothing.
    }

    const fused = fuse(byMeaning, byWords, byName).slice(0, most);
    const held = new Map(this.index.held(fused.map((one) => one.id)).map((one) => [one.hash, one]));

    return fused.flatMap((one) => {
      const found = held.get(one.id);
      return found ? [{ ...found, score: one.score }] : [];
    });
  }
}
