import type { Watching } from "#agent/loop.ts";
import type { Ask } from "#agent/tool.ts";
import type { Gate } from "#permission/gate.ts";
import { producedBy } from "#playbook/invoke.ts";
import type { Outcome, ProofResult, RunLog } from "#playbook/runlog.ts";
import { runPlaybook, type Performer } from "#playbook/runner.ts";
import type { Playbooks } from "#playbook/store.ts";
import type { Sessions } from "#session/store.ts";
import { answered, opened } from "#session/thread.ts";

export type Performing = {
  books: Playbooks;
  runs: RunLog;
  sessions: Sessions;
  gate: Gate;
  ask: Ask;
  vault: string;
  home: string;
  perform: Performer;
  watching?: Watching;
};

export type Asked = {
  name: string;
  inputs: Record<string, string>;
  /// The words that asked for it, as a command would have been typed, which is the first turn.
  saying: string;
  pane: unknown;
  signal?: AbortSignal;
};

export type Performed = {
  outcome: Outcome;
  proof: ProofResult[];
  log: string;
  said: string;
  inputs: Record<string, string>;
  produced?: { path: string; text: string };
  answer: string;
  session?: string;
};

/// How a run came out, in a few words.
export function wordsFor(outcome: Outcome, proof: ProofResult[]): string {
  if (outcome === "done") return "proof passed";
  if (outcome === "failed") return `proof failed: ${proof.filter((one) => one.passed === false).map((one) => one.why).join("; ")}`;
  return "not everything could be judged";
}

/// Runs an approved playbook as a conversation: what asked for it and what came of it are kept
/// in a pane, so a page's past is its own and a run can be read back later, and the file it
/// produced is shown rather than pointed at.
export async function performPlaybook(on: Performing, asked: Asked): Promise<Performed> {
  const book = on.books.read(asked.name);
  if (!book) throw new Error(`there is no approved playbook named ${asked.name}`);
  const thread = opened(on.sessions, undefined, asked.pane, asked.saying, asked.saying.slice(0, 80));
  // The run itself is a step, ended by its proof, so what is watching sees it finish and how.
  const whole = on.watching?.began("playbook", asked.name);

  let ran: Awaited<ReturnType<typeof runPlaybook>>;
  try {
    ran = await runPlaybook({
      books: on.books,
      log: on.runs,
      name: asked.name,
      inputs: asked.inputs,
      vault: on.vault,
      home: on.home,
      gate: on.gate,
      ask: on.ask,
      perform: on.perform,
      watching: on.watching,
      exposed: thread.exposed,
      signal: asked.signal,
    });
  } catch (failure) {
    if (whole !== undefined) on.watching?.ended(whole, false);
    throw failure;
  }
  if (whole !== undefined) on.watching?.ended(whole, ran.run.outcome === "done");
  const produced = producedBy(book, asked.inputs, on.home);
  const outcome =
    ran.run.outcome === "done"
      ? ran.transcript.text
      : ran.run.outcome === "failed"
        ? `The ${wordsFor("failed", ran.run.proof).replace("proof failed", "proof did not pass")}\n\n${ran.transcript.text}`
        : `Not everything could be judged.\n\n${ran.transcript.text}`;
  const answer = produced ? `${produced.text}\n\n---\n\n${outcome}` : outcome;
  answered(
    on.sessions,
    thread,
    answer,
    { model: ran.transcript.model, route: ran.transcript.route, usage: ran.transcript.usage },
    ran.transcript.exposed === true,
  );

  return {
    outcome: ran.run.outcome,
    proof: ran.run.proof,
    log: ran.path,
    said: ran.transcript.text,
    inputs: asked.inputs,
    produced,
    answer,
    session: thread.session?.id,
  };
}
