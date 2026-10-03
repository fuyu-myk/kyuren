import { realpathSync } from "node:fs";
import { basename, isAbsolute, relative } from "node:path";
import { z } from "zod";
import type { Harness } from "#coding/session.ts";

/// A coding agent asking the user's permission, held on the island until it is answered there or
/// handed back to the agent's own prompt.
export type Ask = {
  id: string;
  harness: Harness;
  session: string;
  project: string;
  tool: string;
  /// What it wants to do, in a word or two: run, read, fetch.
  verb: string;
  /// What it would do it to, exactly as it would be done: the command, the file, the address.
  target: string;
  at: number;
  /// When it is handed back to the agent, to ask in its own way.
  until: number;
};

export type Decision = "allow" | "deny" | "ask";

/// The longest target the island shows whole. Anything longer is the agent's own to ask, since an
/// answer given on a part of a command is not an answer to the command.
export const WHOLE = 160;

/// Any control or format character, and any blank wider or stranger than a space: a line break, a
/// terminal escape, a direction override, a zero-width or a wide space, a filler drawn as nothing,
/// each of which can make what is shown differ from what would run. The spaces that only differ
/// from a plain one in where a line may break are as plain, and the Mac names screenshots with one.
const HIDING = /(?![ \u00A0\u202F])[\p{C}\p{Z}\u115F\u1160\u2800\u3164\uFFA0]/u;

const REQUEST = z.object({
  session_id: z.string().min(1).max(200),
  cwd: z.string().min(1).max(4096),
  tool_name: z.string().min(1).max(200),
  tool_input: z.record(z.string(), z.unknown()).default({}),
});

function text(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  return typeof value === "string" ? value : "";
}

/// Where a path leads once its links are followed, spelled as the disk keeps it: a link in the
/// project to a file outside it is shown as that file, since reading it is what an answer allows.
function real(path: string): string {
  if (!isAbsolute(path)) return path;
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
}

function placed(path: string, cwd: string): string {
  const inside = relative(cwd, path);
  return path && !inside.startsWith("..") && !inside.startsWith("/") ? inside : path;
}

/// The tools whose whole effect is the one thing the island shows. An edit's change, a file's
/// contents and a plugin's arguments are what matter in theirs, and the island shows none of them,
/// so those, and every tool not named here, are asked by the agent itself, which shows them.
function said(tool: string, input: Record<string, unknown>, cwd: string): { verb: string; target: string } | undefined {
  if (tool === "Bash") return input.dangerouslyDisableSandbox ? undefined : { verb: "run", target: text(input, "command") };
  if (tool === "Read") return { verb: "read", target: placed(real(text(input, "file_path")), real(cwd)) };
  if (tool === "WebFetch") return { verb: "fetch", target: text(input, "url") };
  if (tool === "WebSearch") return { verb: "search the web for", target: text(input, "query") };
  return undefined;
}

/// The permission Claude Code is about to ask for, as the island shows it: only one it can show
/// whole and as it would run. Anything else is nothing, and Claude Code asks it at once.
export function claudeAsk(payload: unknown, id: string, now: number, wait: number): Ask | undefined {
  const request = REQUEST.safeParse(payload);
  if (!request.success) return undefined;
  const { session_id: session, cwd, tool_name: tool, tool_input: input } = request.data;
  const shown = said(tool, input, cwd);
  const project = basename(cwd);
  if (!shown || shown.target.length === 0 || shown.target.length > WHOLE || HIDING.test(shown.target)) return undefined;
  if (HIDING.test(project)) return undefined;
  return { id, harness: "claude", session, project, tool, verb: shown.verb, target: shown.target, at: now, until: now + wait };
}

/// Claude Code's own decision for an answer given on the island. Left to Claude Code, nothing is
/// said, and it shows its prompt.
export function claudeAnswer(decision: Decision): string {
  if (decision === "ask") return "";
  const answered =
    decision === "allow"
      ? { behavior: "allow" }
      : { behavior: "deny", message: "The user denied this on Kyuren's island." };
  return JSON.stringify({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: answered } });
}
