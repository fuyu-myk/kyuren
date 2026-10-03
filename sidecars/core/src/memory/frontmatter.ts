export type Front = {
  /// The note without its frontmatter, which is what is read and searched.
  body: string;
  fields: Record<string, string[]>;
};

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/// Enough YAML for what notes actually carry: scalars, inline lists and dashed lists. A full
/// parser would be a dependency for a header that is nearly always four lines of tags.
function values(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed === "") return [];

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((one) => bare(one))
      .filter((one) => one !== "");
  }

  return [bare(trimmed)].filter((one) => one !== "");
}

function bare(text: string): string {
  return text.trim().replace(/^["']|["']$/g, "").trim();
}

export function frontmatter(markdown: string): Front {
  const found = FENCE.exec(markdown);
  if (!found) return { body: markdown, fields: {} };

  const fields: Record<string, string[]> = {};
  let key: string | undefined;

  for (const line of (found[1] ?? "").split(/\r?\n/)) {
    const dashed = /^\s*-\s+(.*)$/.exec(line);
    if (dashed && key) {
      fields[key] = [...(fields[key] ?? []), ...values(dashed[1] ?? "")];
      continue;
    }

    const pair = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!pair) continue;
    key = pair[1] ?? "";
    fields[key] = values(pair[2] ?? "");
  }

  return { body: markdown.slice(found[0].length), fields };
}

/// Tags read as words so they can be searched for. Obsidian writes them both in frontmatter and
/// inline, and either way they say what a note is about.
export function tagsOf(front: Front, body: string): string[] {
  const inline = [...body.matchAll(/(?:^|\s)#([\p{L}][\p{L}\p{N}_/-]*)/gu)].map((one) => one[1] ?? "");
  const declared = [...(front.fields.tags ?? []), ...(front.fields.tag ?? [])];
  return [...new Set([...declared, ...inline].map((one) => one.replace(/^#/, "")).filter(Boolean))];
}
