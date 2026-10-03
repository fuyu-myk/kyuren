export type Piece =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "emphasis"; text: string }
  | { kind: "link"; text: string; href: string };

export type Block =
  | { kind: "paragraph"; pieces: Piece[] }
  | { kind: "heading"; level: number; pieces: Piece[] }
  | { kind: "code"; text: string; language?: string }
  | { kind: "list"; ordered: boolean; items: Piece[][] }
  | { kind: "quote"; pieces: Piece[] };

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(_[^_\n]+_)|(\[[^\]\n]+\]\([^)\s]+\))/g;

/// The small part of markdown an answer actually uses. Read into pieces rather than into HTML,
/// because pieces become elements and HTML would have to be trusted.
export function inline(text: string): Piece[] {
  const pieces: Piece[] = [];
  let at = 0;

  for (const found of text.matchAll(INLINE)) {
    const where = found.index;
    if (where > at) pieces.push({ kind: "text", text: text.slice(at, where) });
    const mark = found[0];

    if (mark.startsWith("`")) {
      pieces.push({ kind: "code", text: mark.slice(1, -1) });
    } else if (mark.startsWith("**")) {
      pieces.push({ kind: "strong", text: mark.slice(2, -2) });
    } else if (mark.startsWith("[")) {
      const split = mark.indexOf("](");
      pieces.push({
        kind: "link",
        text: mark.slice(1, split),
        href: mark.slice(split + 2, -1),
      });
    } else {
      pieces.push({ kind: "emphasis", text: mark.slice(1, -1) });
    }
    at = where + mark.length;
  }

  if (at < text.length) pieces.push({ kind: "text", text: text.slice(at) });
  return pieces;
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBER = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const FENCE = /^```\s*(\S*)\s*$/;

export function blocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const found: Block[] = [];
  let held: string[] = [];

  function endParagraph(): void {
    if (held.length === 0) return;
    found.push({ kind: "paragraph", pieces: inline(held.join("\n")) });
    held = [];
  }

  for (let at = 0; at < lines.length; at += 1) {
    const line = lines[at]!;

    const fence = FENCE.exec(line);
    if (fence) {
      endParagraph();
      const code: string[] = [];
      at += 1;
      // An unclosed fence runs to the end rather than swallowing the answer into nothing.
      while (at < lines.length && !FENCE.test(lines[at]!)) {
        code.push(lines[at]!);
        at += 1;
      }
      found.push({
        kind: "code",
        text: code.join("\n"),
        language: fence[1] === "" ? undefined : fence[1],
      });
      continue;
    }

    if (line.trim() === "") {
      endParagraph();
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      endParagraph();
      found.push({
        kind: "heading",
        level: heading[1]!.length,
        pieces: inline(heading[2]!),
      });
      continue;
    }

    const bullet = BULLET.exec(line);
    const number = NUMBER.exec(line);
    if (bullet || number) {
      endParagraph();
      const ordered = number !== null;
      const items: Piece[][] = [];
      while (at < lines.length) {
        const same = ordered ? NUMBER.exec(lines[at]!) : BULLET.exec(lines[at]!);
        if (!same) break;
        items.push(inline(same[1]!));
        at += 1;
      }
      at -= 1;
      found.push({ kind: "list", ordered, items });
      continue;
    }

    const quote = QUOTE.exec(line);
    if (quote) {
      endParagraph();
      const said: string[] = [quote[1]!];
      while (at + 1 < lines.length && QUOTE.test(lines[at + 1]!)) {
        at += 1;
        said.push(QUOTE.exec(lines[at]!)![1]!);
      }
      found.push({ kind: "quote", pieces: inline(said.join("\n")) });
      continue;
    }

    held.push(line);
  }

  endParagraph();
  return found;
}
