import type { DiffLine } from "#coding/changes.ts";
import { HIDING, landing, placed, real, shownLines, text, type Request } from "#coding/shown.ts";

/// An edit as the island shows it before it is made: the file, and the change as lines taken out
/// and put in.
export type Edit = { kind: "edit"; path: string; fresh: boolean; whole: boolean; every: boolean; diff: DiffLine[]; added: number; removed: number };

/// The most lines of change the island shows. A longer change is read where it is made.
export const EDIT_LINES = 400;
/// And the most text, however its lines fall.
export const EDIT_MOST = 40_000;

const EDITS = new Set(["Edit", "Write", "MultiEdit"]);

function linesOf(content: string): string[] {
  if (content === "") return [];
  return content.endsWith("\n") ? content.slice(0, -1).split("\n") : content.split("\n");
}

/// One replacement: the old text's lines taken out and the new text's put in.
function replaced(before: string, after: string): DiffLine[] {
  return [...linesOf(before).map((line) => ({ kind: "-" as const, text: line })), ...linesOf(after).map((line) => ({ kind: "+" as const, text: line }))];
}

/// Whether a replacement is made wherever its text is found, read as Claude Code reads it, or
/// nothing when that cannot be told.
function everywhere(value: unknown): boolean | undefined {
  if (value === undefined || value === false || value === "false") return false;
  return value === true || value === "true" ? true : undefined;
}

/// Every replacement a request would make, or nothing when one is not text.
function changes(tool: string, input: Record<string, unknown>): Array<{ before: string; after: string; every: boolean }> | undefined {
  if (tool === "Edit") {
    const every = everywhere(input.replace_all);
    if (typeof input.old_string !== "string" || typeof input.new_string !== "string" || every === undefined) return undefined;
    return [{ before: input.old_string, after: input.new_string, every }];
  }
  if (tool === "MultiEdit") {
    if (!Array.isArray(input.edits) || input.edits.length === 0) return undefined;
    const all = input.edits.map((one: unknown) => {
      const edit = typeof one === "object" && one !== null ? (one as Record<string, unknown>) : {};
      const every = everywhere(edit.replace_all);
      return typeof edit.old_string === "string" && typeof edit.new_string === "string" && every !== undefined
        ? { before: edit.old_string, after: edit.new_string, every }
        : undefined;
    });
    return all.every((one) => one !== undefined) ? all : undefined;
  }
  return undefined;
}

/// An edit Claude Code is about to ask to make, as the island shows it: the whole change, or
/// nothing, so that Claude Code asks it itself, when the change is too long to show, holds
/// something hidden, or is not an edit.
export function editOf(request: Request): Edit | undefined {
  const { cwd, tool_name: tool, tool_input: input } = request;
  if (!EDITS.has(tool)) return undefined;
  const file = text(input, "file_path");
  const landed = file === "" || HIDING.test(file) ? undefined : landing(file);
  if (!landed || HIDING.test(landed.path)) return undefined;
  const path = placed(landed.path, real(cwd));
  const { fresh } = landed;

  let diff: DiffLine[];
  let every = false;
  let size: number;
  if (tool === "Write") {
    if (typeof input.content !== "string") return undefined;
    const content = shownLines(input.content);
    if (content === undefined) return undefined;
    diff = [{ kind: "@", text: fresh ? "a new file" : "the whole file, as it will be" }, ...linesOf(content).map((line) => ({ kind: "+" as const, text: line }))];
    size = content.length;
  } else {
    const made = changes(tool, input);
    if (!made) return undefined;
    const shown = made.map((one) => ({ ...one, before: shownLines(one.before), after: shownLines(one.after) }));
    if (shown.some((one) => one.before === undefined || one.after === undefined)) return undefined;
    every = made.some((one) => one.every);
    diff = shown.flatMap((one, at) => [
      { kind: "@" as const, text: one.every ? `change ${at + 1}, wherever it is found` : `change ${at + 1}` },
      ...replaced(one.before as string, one.after as string),
    ]);
    size = shown.reduce((sum, one) => sum + (one.before as string).length + (one.after as string).length, 0);
  }
  if (diff.length > EDIT_LINES || size > EDIT_MOST) return undefined;
  const added = diff.filter((line) => line.kind === "+").length;
  const removed = diff.filter((line) => line.kind === "-").length;
  return { kind: "edit", path, fresh, whole: tool === "Write", every, diff, added, removed };
}
