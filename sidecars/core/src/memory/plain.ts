/// Markdown as words rather than as markup.
///
/// A day's note is full of link references and emphasis, and indexing them dilutes what the note
/// actually says: a chunk listing four deadlines was outranked by a sentence merely mentioning the
/// subject, because half its words were addresses and brackets.
///
/// Hashing the plain form also means changing only the formatting of a note does not re-embed it.
export function plainly(markdown: string): string {
  const stripped = markdown
    // Reference definitions carry an entire address and not one word worth finding.
    .replace(/^[ \t]*\[[^\]]+\]:[ \t]*\S+.*$/gm, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    // A wiki link is how Obsidian writes a name. Left as brackets it is indexed as punctuation.
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_all, target, shown) => shown || target)
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    // Anchored patterns count spaces and tabs only. Letting these match any whitespace swallowed
    // the blank line between a heading and what follows it, running the two together.
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "")
    .replace(/^[ \t]*[-*+][ \t]+/gm, "")
    .replace(/^[ \t]*>[ \t]?/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|\s)[_*]([^_*\n]+)[_*](?=\s|$|[.,;:!?)])/g, "$1$2")
    .replace(/[ \t]+/g, " ");

  // Blank runs are collapsed after the lines are trimmed, or a line left holding a space counts as
  // content and keeps two blank lines apart.
  return stripped
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
