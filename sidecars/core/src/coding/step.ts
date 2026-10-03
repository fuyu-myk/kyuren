import { type Change, changesOf, printed } from "#coding/changes.ts";
import { fields, placed, record, text } from "#coding/said.ts";
import type { Step } from "#coding/timeline.ts";

/// Lines of what a step printed that are shown at first: the end of a command's, where it says how
/// it went.
const OUTPUT = 200;
/// Characters of output given when all of it is asked for, the end of anything longer, so a runaway
/// log cannot stall the island.
const WHOLE = 2 << 20;
const READ = 150;
const WIDE = 400;
const PROMPT = 4000;
const EDITS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);
const TODO: Record<string, string> = { completed: "done", in_progress: "doing", pending: "to do" };

/// One step opened: what it was given and what came of it, as fits what it did.
export type StepDetail = { ok: boolean | null; output: string[]; earlier: number } & (
  | { kind: "run"; command: string; about: string | null; code: number | null; background: boolean; changes: Change[] }
  | { kind: "edit"; changes: Change[] }
  | { kind: "read"; path: string; from: number | null; lines: number | null; of: number | null; content: string[]; image: boolean }
  | { kind: "agent"; about: string; prompt: string; agent: string | null; steps: Step[] }
  | { kind: "other"; fields: Array<[string, string]> }
);

/// Cut between characters, keeping a line's own spacing, which code and output depend on.
function clipped(line: string, most = WIDE): string {
  if (line.length <= most) return line;
  const characters = Array.from(line);
  return characters.length > most ? `${characters.slice(0, most - 1).join("")}…` : line;
}

function linesOf(said: string): string[] {
  const trimmed = said.replace(/\s+$/, "");
  return trimmed === "" ? [] : trimmed.split("\n");
}

function tail(said: string, whole = false): { output: string[]; earlier: number } {
  const all = linesOf(said);
  if (!whole) return { output: all.slice(-OUTPUT).map((line) => clipped(line)), earlier: Math.max(0, all.length - OUTPUT) };
  let start = all.length;
  let room = WHOLE;
  while (start > 0 && room >= (all[start - 1]?.length ?? 0) + 1) {
    room -= (all[start - 1]?.length ?? 0) + 1;
    start -= 1;
  }
  if (start === all.length && start > 0) return { output: [clipped(all[start - 1] ?? "", WHOLE)], earlier: start - 1 };
  return { output: all.slice(start), earlier: start };
}

function head(said: string): { output: string[]; earlier: number } {
  return { output: linesOf(said).slice(0, OUTPUT).map((line) => clipped(line)), earlier: 0 };
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function blockOf(line: string, type: string, id: string): { one: Record<string, unknown>; block: Record<string, unknown> } | undefined {
  const one = record(line);
  const content = fields(one?.message).content;
  if (!one || !Array.isArray(content)) return undefined;
  const block = content.map(fields).find((each) => each.type === type && (each.id === id || each.tool_use_id === id));
  return block ? { one, block } : undefined;
}

/// A step's detail from its two lines in the transcript: the one asking for it, and the one with
/// its outcome, which a step still being done has not got yet. A command is given whole, and what
/// it printed whole when `whole` asks for it.
export function stepDetail(id: string, useLine: string, resultLine: string | undefined, base: string | null, whole = false): StepDetail | null {
  const used = blockOf(useLine, "tool_use", id);
  if (!used) return null;
  const name = text(used.block, "name");
  const input = fields(used.block.input);
  const answered = resultLine === undefined ? undefined : blockOf(resultLine, "tool_result", id);
  const ok = answered ? answered.block.is_error !== true : null;
  const result = answered?.one.toolUseResult;
  const said = answered ? printed(result, answered.block) : "";
  const quiet = { output: [], earlier: 0 };

  if (name === "Bash") {
    // Left running in the background, it printed to a file of its own, and its end is not here.
    const background = typeof fields(result).backgroundTaskId === "string";
    const code = background ? null : ok === true ? 0 : typeof result === "string" ? number(Number(/Exit code (\d+)/.exec(result)?.[1])) : null;
    const command = clipped(text(input, "command"), WHOLE);
    const about = text(input, "description") || null;
    return { kind: "run", ok, command, about, code, background, changes: ok ? changesOf(name, input, result, base) : [], ...tail(said, whole) };
  }
  if (EDITS.has(name)) {
    return { kind: "edit", ok, changes: ok ? changesOf(name, input, result, base) : [], ...(ok === false ? tail(said) : quiet) };
  }
  if (name === "Read") {
    const done = fields(result);
    const file = fields(done.file);
    const path = placed(text(file, "filePath") || text(input, "file_path"), base);
    const content = linesOf(text(file, "content")).slice(0, READ).map((line) => clipped(line));
    const range = { from: number(file.startLine), lines: number(file.numLines), of: number(file.totalLines) };
    return { kind: "read", ok, path, ...range, content, image: done.type === "image", ...(ok === false ? tail(said) : quiet) };
  }
  if (name === "Agent" || name === "Task") {
    const agent = text(fields(result), "agentId") || null;
    return { kind: "agent", ok, about: text(input, "description"), prompt: clipped(text(input, "prompt"), PROMPT), agent, steps: [], ...head(said) };
  }
  const given = Object.entries(input).flatMap(([key, value]): Array<[string, string]> =>
    typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? [[key, clipped(String(value))]] : [],
  );
  if (name === "TodoWrite") {
    const todos = Array.isArray(fields(result).newTodos) ? (fields(result).newTodos as unknown[]) : Array.isArray(input.todos) ? input.todos : [];
    const output = todos.map(fields).map((todo) => `${TODO[text(todo, "status")] ?? text(todo, "status")}: ${clipped(text(todo, "content"))}`);
    return { kind: "other", ok, fields: given, output, earlier: 0 };
  }
  return { kind: "other", ok, fields: given, ...tail(said) };
}
