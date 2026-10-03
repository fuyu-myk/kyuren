import { z } from "zod";
import type { Route } from "#model/route.ts";
import type { Run as Turn, Transcript, Watching } from "#agent/loop.ts";
import type { Ask, Tool } from "#agent/tool.ts";
import type { Gate } from "#permission/gate.ts";
import type { RunLog } from "#playbook/runlog.ts";
import { runPlaybook, type Ran } from "#playbook/runner.ts";
import { sharedPlaybooks } from "#playbook/shared.ts";
import type { Playbooks } from "#playbook/store.ts";
import { inHandfuls } from "#projects/pool.ts";

/// How many sub-runs go at once. Each is a model at work with tools; a handful is the most the
/// machine answers for, and the same handful the board gives repositories.
const HANDFUL = 3;

export const playbookSchema = z.object({
  name: z.string().describe("the name of an approved playbook"),
  inputs: z.record(z.string(), z.string()).optional().describe("the inputs the playbook asks for"),
});

export const playbooksSchema = z.object({
  runs: z
    .array(
      z.object({
        name: z.string().describe("the name of an approved playbook"),
        inputs: z.record(z.string(), z.string()).optional().describe("the inputs that run asks for"),
      }),
    )
    .min(1)
    .max(12)
    .describe("the runs to start, each with its own inputs"),
});

export type Performing = {
  perform: (turn: Turn) => Promise<Transcript>;
  vault: string;
  home: string;
  books: Playbooks;
  runs: RunLog;
  gate: Gate;
  ask: Ask;
  watching?: Watching;
  /// Told of every run started, so a run that starts others can prove them.
  onRan?: (ran: Ran) => void;
  /// Whether the turn starting these runs holds the user's notes, which a run it starts then holds.
  exposed?: () => boolean;
  /// Whether what the turn starting these runs is given goes to a model on the cloud.
  cloud?: () => boolean;
};

/// A sub-run that could not finish, told of as a run that failed, so the parent's proof counts
/// it. Otherwise a check that died halfway leaves the parent free to read whatever check was on
/// disk from an earlier run, and to say it was checked.
function unfinished(name: string, reason: string): Ran {
  return {
    run: {
      playbook: name,
      startedAt: new Date().toISOString(),
      inputs: {},
      route: "",
      model: "",
      calls: [],
      proof: [],
      outcome: "failed",
      closing: `could not finish: ${reason}`,
    },
    transcript: { text: "", difficulty: "hard", route: "cloud", model: "", reason: "", steps: 0, called: [], elapsedMs: 0 },
    path: "",
  };
}

function start(on: Performing, name: string, inputs: Record<string, string>, signal: AbortSignal): Promise<Ran> {
  return runPlaybook({
    books: on.books,
    log: on.runs,
    name,
    inputs,
    vault: on.vault,
    home: on.home,
    gate: on.gate,
    ask: on.ask,
    perform: on.perform,
    watching: on.watching,
    signal,
    exposed: on.exposed?.(),
    cloudAbove: on.cloud?.(),
  });
}

/// Running one of the approved playbooks. Declared as execution, since a playbook is a procedure
/// with tools in it, and named by the playbook, so approving a playbook can also be allowing it.
export function playbookTool(on: Performing): Tool<z.infer<typeof playbookSchema>> {
  return {
    name: "playbook",
    description:
      "Run one of the approved playbooks by name, with the inputs it asks for. Use this when the "
      + "request matches what a playbook is for; the result says whether its proof passed.",
    describe: (args) => ({ tool: "playbook", effect: "execute", target: args.name }),
    run: async (args, signal) => {
      let ran: Ran;
      try {
        ran = await start(on, args.name, args.inputs ?? {}, signal);
      } catch (failure) {
        const reason = failure instanceof Error ? failure.message : String(failure);
        on.onRan?.(unfinished(args.name, reason));
        throw failure;
      }
      on.onRan?.(ran);
      return { outcome: ran.run.outcome, proof: ran.run.proof, log: ran.path, said: ran.transcript.text };
    },
  };
}

/// Running several approved playbooks at once, a handful at a time through the pool that runs
/// repositories. Each leaves its own log, and each is told of, so the parent can prove them; one
/// that cannot start says why and the rest go on.
export function playbooksTool(on: Performing): Tool<z.infer<typeof playbooksSchema>> {
  return {
    name: "playbooks",
    description:
      "Run several approved playbooks at once, each with its own inputs and its own log: the same "
      + "playbook over many inputs, or different playbooks that do not depend on each other. The "
      + "result lists each run's outcome and where its log is.",
    describe: (args) => ({
      tool: "playbooks",
      effect: "execute",
      target: [...new Set(args.runs.map((one) => one.name))].join(", "),
    }),
    run: async (args, signal) => {
      const ran = await inHandfuls(args.runs, HANDFUL, async (one) => {
        try {
          const done = await start(on, one.name, one.inputs ?? {}, signal);
          on.onRan?.(done);
          return { name: one.name, outcome: done.run.outcome, proof: done.run.proof, log: done.path, said: done.transcript.text };
        } catch (failure) {
          const reason = failure instanceof Error ? failure.message : String(failure);
          on.onRan?.(unfinished(one.name, reason));
          return { name: one.name, outcome: "failed" as const, reason };
        }
      });
      return { ran };
    },
  };
}

export const proposeSchema = z.object({
  markdown: z.string().describe("the whole playbook as markdown, frontmatter and all"),
});

/// Writing a playbook down, new or repaired. It lands pending and nothing runs it until the user
/// approves the text. Offered only on the cloud route: the local models run playbooks and never
/// write them.
export function proposeTool(): Tool<z.infer<typeof proposeSchema>> {
  return {
    name: "playbook_propose",
    description:
      "Propose a new or repaired playbook as markdown. It becomes pending until the user approves "
      + "it, so say what changed and why in the notes. A proof's command runs in a plain POSIX "
      + "shell, not bash.",
    describe: (args) => ({
      tool: "playbook_propose",
      effect: "write",
      target: `playbook:${/^name:\s*(.+)$/m.exec(args.markdown)?.[1]?.trim() ?? "unnamed"}`,
    }),
    run: async (args) => {
      const book = sharedPlaybooks().propose(args.markdown);
      return { pending: book.name, version: book.version };
    },
  };
}

/// Whether a route may write playbooks at all. Only the frontier model may, so the tool exists on
/// the cloud route and on no other; a local model cannot be talked into a tool it was never given.
export function authoringOffered(route: Route): boolean {
  return route === "cloud";
}
