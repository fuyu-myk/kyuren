import { fields, placed, text } from "#coding/said.ts";

export type DiffLine = { kind: "@" | " " | "-" | "+"; text: string };
export type Change = { path: string; added: number; removed: number; diff: DiffLine[] };

/// Lines of one change shown, enough to read it whole in most cases.
const DIFF = 200;
const EDITS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

function diffOf(patch: unknown): Omit<Change, "path"> {
  const diff: DiffLine[] = [];
  let added = 0;
  let removed = 0;
  if (!Array.isArray(patch)) return { diff, added, removed };
  for (const hunk of patch) {
    const { oldStart, oldLines, newStart, newLines, lines } = fields(hunk);
    diff.push({ kind: "@", text: `@@ -${oldStart},${oldLines} +${newStart},${newLines} @@` });
    for (const raw of Array.isArray(lines) ? lines : []) {
      if (typeof raw !== "string") continue;
      const kind = raw[0] === "+" || raw[0] === "-" ? raw[0] : " ";
      if (kind === "+") added += 1;
      if (kind === "-") removed += 1;
      diff.push({ kind, text: raw.slice(1) });
    }
  }
  return { diff: diff.slice(0, DIFF), added, removed };
}

/// A file written new comes with its whole content and no patch, since there was nothing before it.
function createdAs(content: string): Omit<Change, "path"> {
  const written = content.endsWith("\n") ? content.slice(0, -1).split("\n") : content.split("\n");
  const diff: DiffLine[] = [{ kind: "@", text: `@@ -0,0 +1,${written.length} @@` }, ...written.slice(0, DIFF - 1).map((line) => ({ kind: "+" as const, text: line }))];
  return { diff, added: written.length, removed: 0 };
}

/// The files a finished step changed: an edit's own, or whatever a command was seen to change.
export function changesOf(name: string, input: Record<string, unknown>, result: unknown, base: string | null): Change[] {
  const done = fields(result);
  if (EDITS.has(name)) {
    const path = placed(typeof done.filePath === "string" ? done.filePath : text(input, "file_path"), base);
    const change = done.type === "create" && typeof done.content === "string" ? createdAs(done.content) : diffOf(done.structuredPatch);
    return [{ path, ...change }];
  }
  const seen = fields(done.bashEditDiff).files;
  if (!Array.isArray(seen)) return [];
  return seen.flatMap((file) => {
    const one = fields(file);
    return typeof one.filePath === "string" ? [{ path: placed(one.filePath, base), ...diffOf(one.hunks) }] : [];
  });
}

/// What a step printed. A command that failed is kept by the harness as its message alone.
export function printed(result: unknown, block: Record<string, unknown>): string {
  if (typeof result === "string") return result;
  const { stdout, stderr } = fields(result);
  if (typeof stdout === "string" || typeof stderr === "string") return `${typeof stdout === "string" ? stdout : ""}\n${typeof stderr === "string" ? stderr : ""}`;
  if (typeof block.content === "string") return block.content;
  return Array.isArray(block.content) ? block.content.map((part) => text(fields(part), "text")).join("\n") : "";
}
