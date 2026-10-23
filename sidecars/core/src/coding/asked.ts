import type { DiffLine } from "#coding/changes.ts";
import { editOf } from "#coding/edits.ts";
import type { Harness } from "#coding/session.ts";
import { HIDING, landing, placed, projectOf, real, requestOf, shownLines, text } from "#coding/shown.ts";

/// Who is waiting, where, and until when it is held before it goes back to the agent to be asked
/// in its own way.
type Asking = {
  id: string;
  harness: Harness;
  session: string;
  project: string;
  tool: string;
  at: number;
  until: number;
};

export type Question = { question: string; header: string; options: Array<{ label: string; description: string }>; multiSelect: boolean };
/// A form's field. Its bounds are the least and most a number may be, or how few and how many
/// characters words may have.
export type Field = { name: string; title: string; about: string; type: "string" | "number" | "integer" | "boolean"; choices: string[]; required: boolean; least?: number; most?: number };

/// A coding agent waiting on the user, held on the island until it is answered there or handed
/// back to the agent's own prompt: a permission, questions to choose among, a plan to approve, an
/// edit to allow, or a form one of its servers asks to have filled in.
export type Ask = Asking &
  (
    | {
        kind: "permission";
        /// What it wants to do, in a word or two: run, read, fetch.
        verb: string;
        /// What it would do it to, exactly as it would be done: the command, the file, the address.
        target: string;
      }
    | { kind: "choice"; questions: Question[] }
    | { kind: "plan"; plan: string }
    | {
        kind: "edit";
        path: string;
        /// No file is there yet.
        fresh: boolean;
        /// The file is written whole, as shown.
        whole: boolean;
        /// The change is made wherever its old text is found, not once.
        every: boolean;
        diff: DiffLine[];
        added: number;
        removed: number;
      }
    | { kind: "form"; server: string; message: string; fields: Field[] }
  );

export type Kind = Ask["kind"];
export type Decision = "allow" | "deny" | "ask";

/// What was answered on the island: a decision, and with it what was picked for each question, the
/// mode an approved plan goes on in, or a form's values.
export type Answer = {
  decision: Decision;
  picked?: Record<string, string[]>;
  mode?: "acceptEdits" | "default";
  content?: Record<string, string | number | boolean>;
};

/// How long each kind is held: one number for all, or one for each.
export type Wait = number | ((kind: Kind) => number);

export function waited(wait: Wait, kind: Kind): number {
  return typeof wait === "number" ? wait : wait(kind);
}

/// The longest target the island shows whole. Anything longer is the agent's own to ask, since an
/// answer given on a part of a command is not an answer to the command.
export const WHOLE = 160;
/// The longest plan the island holds. One longer is for reading where it was written.
export const PLAN_MOST = 20_000;

/// The tools whose whole effect is the one thing a permission shows. An edit and a plan are shown
/// in their own way; a plugin's arguments are what matter in its call, and the island does not show
/// them, so those, and every tool not named here, are asked by the agent itself.
function said(tool: string, input: Record<string, unknown>, cwd: string): { verb: string; target: string } | undefined {
  if (tool === "Bash") return input.dangerouslyDisableSandbox ? undefined : { verb: "run", target: text(input, "command") };
  if (tool === "Read") {
    const landed = landing(text(input, "file_path"));
    return landed ? { verb: "read", target: placed(landed.path, real(cwd)) } : undefined;
  }
  if (tool === "WebFetch") return { verb: "fetch", target: text(input, "url") };
  if (tool === "WebSearch") return { verb: "search the web for", target: text(input, "query") };
  return undefined;
}

/// The plan Claude Code asks to have approved, which it puts into the request from the file the
/// plan was written to.
function planned(input: Record<string, unknown>): string | undefined {
  // Before Claude Code 2.1.205 a plan approved grants the permissions it asks for too, and the
  // island does not show them, so a plan asking for any is approved where they are shown.
  const prompts = input.allowedPrompts;
  if (prompts !== undefined && !(Array.isArray(prompts) && prompts.length === 0)) return undefined;
  const plan = shownLines(text(input, "plan").trim());
  return plan && plan.length <= PLAN_MOST ? plan : undefined;
}

/// What Claude Code is about to ask permission for, as the island shows it: a plan, an edit or a
/// permission it can show whole and as it would happen. Anything else is nothing, and Claude Code
/// asks it at once.
export function claudeAsk(payload: unknown, id: string, now: number, wait: Wait): Ask | undefined {
  const request = requestOf(payload);
  if (!request) return undefined;
  const { session_id: session, cwd, tool_name: tool, tool_input: input } = request;
  const project = projectOf(cwd);
  if (project === undefined) return undefined;
  const asking = { id, harness: "claude" as const, session, project, tool, at: now };
  if (tool === "ExitPlanMode") {
    const plan = planned(input);
    return plan ? { ...asking, kind: "plan", plan, until: now + waited(wait, "plan") } : undefined;
  }
  const edit = editOf(request);
  if (edit) return { ...asking, ...edit, until: now + waited(wait, "edit") };
  const shown = said(tool, input, cwd);
  if (!shown || shown.target.length === 0 || shown.target.length > WHOLE || HIDING.test(shown.target)) return undefined;
  return { ...asking, kind: "permission", verb: shown.verb, target: shown.target, until: now + waited(wait, "permission") };
}

/// What a session held on the island is waiting for, in a few words that name nothing it would
/// touch, since sessions are kept in the event log.
export function waitingFor(ask: Ask): string {
  if (ask.kind === "permission") return `permission to ${ask.verb}`;
  if (ask.kind === "choice") return ask.questions.length === 1 ? "an answer to its question" : "answers to its questions";
  if (ask.kind === "plan") return "its plan to be approved";
  if (ask.kind === "edit") return ask.fresh ? "permission to create a file" : "permission to edit a file";
  return `a form for ${ask.server}`;
}

/// Claude Code's own decision on a permission, given on the island. Left to Claude Code, nothing is
/// said, and it shows its prompt.
export function claudeAnswer(decision: Decision): string {
  if (decision === "ask") return "";
  const answered =
    decision === "allow"
      ? { behavior: "allow" }
      : { behavior: "deny", message: "The user denied this on Kyuren's island." };
  return JSON.stringify({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: answered } });
}

/// An approved plan goes on in the mode chosen with it, for this session alone, and one sent back
/// is planned further. Nothing that fits neither is said.
export function claudePlanAnswer(answer: Answer): string | undefined {
  if (answer.decision === "ask") return "";
  if (answer.decision === "deny") {
    const kept = { behavior: "deny", message: "The user wants to keep planning, and said so on Kyuren's island." };
    return JSON.stringify({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: kept } });
  }
  if (answer.mode !== "acceptEdits" && answer.mode !== "default") return undefined;
  const approved = { behavior: "allow", updatedPermissions: [{ type: "setMode", mode: answer.mode, destination: "session" }] };
  return JSON.stringify({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: approved } });
}
