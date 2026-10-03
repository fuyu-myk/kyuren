import { createHash } from "node:crypto";
import { plainly } from "#memory/plain.ts";

export type Chunk = {
  /// What is embedded and searched. Carries the heading so a fragment read on its own still says
  /// what it belongs to.
  text: string;
  /// Identifies the content, not the position. A chunk that has not changed keeps its hash and is
  /// never embedded again, however much moved around it.
  hash: string;
  heading: string;
  order: number;
};

/// Paragraphs per chunk. Boundaries are counted rather than measured, so editing a line changes
/// the chunk it is in and leaves every other boundary where it was. Measuring by length would let
/// one added word push a boundary and rewrite everything after it.
const PARAGRAPHS = 3;

export function hashOf(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

type Block = { heading: string; paragraph: string };

function blocks(markdown: string): Block[] {
  const found: Block[] = [];
  let heading = "";

  for (const part of markdown.split(/\n\s*\n/)) {
    let paragraph = part.trim();
    if (paragraph === "") continue;

    // A heading is usually written against what it introduces, with no blank line between them.
    // Requiring one left whole notes as a single chunk, which buries what is actually being
    // looked for in everything else the note happens to say.
    const title = /^#{1,6}\s+(.*?)\s*(?:\n|$)/.exec(paragraph);
    if (title) {
      heading = title[1]?.trim() ?? "";
      paragraph = paragraph.slice(title[0].length).trim();
      if (paragraph === "") continue;
    }

    // A list is a set of separate facts that happen to be written together. Kept whole, one
    // deadline among four is a quarter of a chunk and loses to a sentence merely mentioning the
    // subject; taken apart, each is findable on its own terms.
    const items = paragraph.split(/\n(?=\s*[-*+]\s)/).map((one) => one.trim()).filter(Boolean);
    if (items.length > 1 && items.every((one) => /^[-*+]\s/.test(one))) {
      for (const item of items) found.push({ heading, paragraph: item });
      continue;
    }

    found.push({ heading, paragraph });
  }

  return found;
}

export function chunk(markdown: string): Chunk[] {
  const chunks: Chunk[] = [];
  let group: Block[] = [];

  const flush = () => {
    if (group.length === 0) return;
    const heading = group[0]?.heading ?? "";
    const body = group.map((one) => one.paragraph).join("\n\n");
    const text = plainly(heading === "" ? body : `${heading}\n\n${body}`);
    if (text === "") {
      group = [];
      return;
    }
    chunks.push({ text, hash: hashOf(text), heading, order: chunks.length });
    group = [];
  };

  for (const block of blocks(markdown)) {
    if (group.length > 0 && (group[0]?.heading !== block.heading || group.length >= PARAGRAPHS)) {
      flush();
    }
    group.push(block);
  }
  flush();

  return chunks;
}
