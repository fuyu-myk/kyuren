import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Project } from "#projects/state.ts";

const run = promisify(execFile);

/// How long a spawned session is given, and how much of what it says is kept.
export const PATIENCE = 10 * 60_000;
const HELD = 20_000;

export type Spawned = {
  project: string;
  path: string;
  said: string;
  ok: boolean;
  turns?: number;
  cost?: number;
  elapsedMs: number;
};

type Reply = {
  result?: unknown;
  is_error?: unknown;
  num_turns?: unknown;
  total_cost_usd?: unknown;
};

/// Reads what a session printed when it finished. Anything unexpected is reported as itself
/// rather than thrown away, because a session that failed still said why.
export function readResult(text: string): { said: string; ok: boolean; turns?: number; cost?: number } {
  try {
    const reply = JSON.parse(text) as Reply;
    const said = typeof reply.result === "string" ? reply.result : text;
    return {
      said: said.slice(0, HELD),
      ok: reply.is_error !== true,
      turns: typeof reply.num_turns === "number" ? reply.num_turns : undefined,
      cost: typeof reply.total_cost_usd === "number" ? reply.total_cost_usd : undefined,
    };
  } catch {
    return { said: text.trim().slice(0, HELD), ok: text.trim() !== "" };
  }
}

/// What a session is started with. The question follows the separator, so one that begins with a
/// dash is asked rather than read as a flag that changes how the session runs.
export function argsFor(asking: string): string[] {
  return ["-p", "--permission-mode", "plan", "--output-format", "json", "--", asking];
}

/// Runs a coding session inside one repository and waits for it to finish.
///
/// It plans rather than edits. Spawning something that can rewrite forty repositories while
/// nobody is watching is a different kind of decision from asking a question about one, and it is
/// not one this makes on the user's behalf.
export async function spawnSession(
  project: Project,
  asking: string,
  signal?: AbortSignal,
): Promise<Spawned> {
  const began = performance.now();

  try {
    const { stdout } = await run(
      "claude",
      argsFor(asking),
      { cwd: project.path, timeout: PATIENCE, maxBuffer: 16_000_000, signal },
    );
    return {
      project: project.name,
      path: project.path,
      elapsedMs: Math.round(performance.now() - began),
      ...readResult(stdout),
    };
  } catch (cause) {
    return {
      project: project.name,
      path: project.path,
      said: cause instanceof Error ? cause.message : String(cause),
      ok: false,
      elapsedMs: Math.round(performance.now() - began),
    };
  }
}
