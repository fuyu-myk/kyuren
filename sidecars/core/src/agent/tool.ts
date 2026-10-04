import { leaves, type Action } from "#permission/action.ts";
import type { Gate } from "#permission/gate.ts";

/// Puts a question to the user; `why` says what makes it a question now when it would not be one
/// otherwise. Stopped before it is answered, the question is withdrawn and taken as a no.
export type Ask = (action: Action, why?: string, signal?: AbortSignal) => Promise<"allow" | "deny">;

/// Whether a turn has the user's notes in it: set by a call that read them, and from then on what
/// would leave the machine is asked about every time. On the cloud, what a call reads goes to the
/// model with the next step, so there a read of notes is asked about before it is made.
export type Exposure = { held: boolean; cloud?: boolean };

export const NOTES_READ = "this conversation has read your notes";
export const NOTES_TO_CLOUD = "what it reads would go to the cloud model";

export type Tool<A> = {
  name: string;
  description: string;
  /// What running this call would actually do. Declared before the call runs, so the gate judges
  /// the effect rather than trusting the tool's name.
  describe: (args: A) => Action;
  run: (args: A, signal: AbortSignal) => Promise<unknown>;
  /// What it hands back is from the user's notes, whatever it read them through.
  notes?: true;
};

export type Outcome =
  | { ok: true; value: unknown }
  | { ok: false; refused: true; reason: string }
  | { ok: false; refused: false; reason: string };

/// The single place a tool is allowed to run. Nothing calls `run` directly. Given the turn's
/// exposure, it keeps it: a call that read the user's notes marks the turn, and once marked,
/// anything that would leave the machine is asked about now and the answer is not kept.
export async function invoke<A>(
  tool: Tool<A>,
  args: A,
  gate: Gate,
  ask: Ask,
  signal: AbortSignal,
  exposure?: Exposure,
): Promise<Outcome> {
  const action = tool.describe(args);
  const notes = tool.notes === true || gate.holdsNotes(action);
  const toCloud = exposure?.cloud === true && notes;
  const fresh = toCloud || (exposure?.held === true && leaves(action));

  let resolution = gate.decide(action, fresh || action.first !== undefined);
  if (resolution.verdict === "ask") {
    const why = [toCloud ? NOTES_TO_CLOUD : fresh ? NOTES_READ : undefined, action.first].filter((one) => one !== undefined);
    const answer = await ask(action, why.length > 0 ? why.join(", and ") : undefined, signal);
    // A no to a first use is about that one thing; kept, it would take back what its host was allowed.
    if (fresh || (action.first !== undefined && answer === "deny")) {
      resolution = gate.once(action, answer);
    } else {
      gate.remember(action, answer);
      resolution = gate.decide(action);
    }
  }

  if (resolution.verdict !== "allow") {
    return {
      ok: false,
      refused: true,
      reason: `${tool.name} was not permitted to ${action.effect} ${action.target}`,
    };
  }

  if (signal.aborted) {
    return { ok: false, refused: false, reason: "cancelled before starting" };
  }

  try {
    const value = await tool.run(args, signal);
    if (exposure && notes) exposure.held = true;
    return { ok: true, value };
  } catch (cause) {
    if (signal.aborted) {
      return { ok: false, refused: false, reason: "cancelled while running" };
    }
    return { ok: false, refused: false, reason: cause instanceof Error ? cause.message : String(cause) };
  }
}
