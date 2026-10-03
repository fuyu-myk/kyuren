import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Decision } from "#coding/asked.ts";
import type { HookListener } from "#coding/hooks.ts";
import { claudeHookState, setClaudeHook } from "#coding/install.ts";
import { SessionDetails } from "#coding/transcript.ts";
import type { CodingWatch } from "#coding/watch.ts";

/// Where the relay is built: beside the core, in the workspace it runs from.
const BUILT = fileURLToPath(new URL("../../../hook/target/release/kyuren-hook", import.meta.url));
const DECISIONS: ReadonlySet<unknown> = new Set<Decision>(["allow", "deny", "ask"]);

function idOf(params: Record<string, unknown>): string {
  if (typeof params.id !== "string") throw new Error("say which question");
  return params.id;
}

export function codingHandlers(watch: CodingWatch, hooks: HookListener, kyurenHome: string, home: string = homedir()) {
  const claudeHome = join(home, ".claude");
  const details = new SessionDetails(join(claudeHome, "projects"));
  return {
    "coding.sessions": async () => ({ sessions: watch.list() }),
    /// Only Claude Code's transcripts are known well enough to read; another harness has no detail.
    "coding.detail": async (params: Record<string, unknown>) => {
      const session = typeof params.session === "string" ? params.session : "";
      if (params.harness != null && params.harness !== "claude") return { detail: null };
      const since = typeof params.since === "number" && Number.isSafeInteger(params.since) && params.since > 0 ? params.since : 0;
      const epoch = typeof params.epoch === "string" ? params.epoch : undefined;
      return { detail: await details.of(session, since, epoch) };
    },
    "coding.step": async (params: Record<string, unknown>) => {
      const session = typeof params.session === "string" ? params.session : "";
      const step = typeof params.step === "string" ? params.step : "";
      const agent = typeof params.agent === "string" ? params.agent : undefined;
      return { step: await details.step(session, step, agent, params.whole === true) };
    },
    /// The process a session runs in, only for a session the watch knows to be running now, so
    /// the host never brings forward an app on a process it was merely told of.
    "coding.where": async (params: Record<string, unknown>) => {
      const session = typeof params.session === "string" ? params.session : "";
      return { pid: watch.list().find((one) => one.id === session)?.pid ?? null };
    },
    "coding.asks": async () => ({ asks: hooks.pending() }),
    /// The island has the question in front of the user.
    "coding.seen": async (params: Record<string, unknown>) => ({ seen: hooks.seen(idOf(params)) }),
    /// An answer given on the island; not answered when the agent stopped waiting for it first.
    "coding.answer": async (params: Record<string, unknown>) => {
      const id = idOf(params);
      if (!DECISIONS.has(params.decision)) throw new Error("an answer is allow, deny or ask");
      return { answered: hooks.answer(id, params.decision as Decision) };
    },
    "coding.hooks": async () => ({ claude: await claudeHookState({ claudeHome, kyurenHome }), listening: hooks.listening() }),
    /// Puts the permission hook into Claude Code's settings, or takes it out. Switched on, the line
    /// is opened too, should it have failed to open when Kyuren started.
    "coding.hooks.set": async (params: Record<string, unknown>) => {
      if (typeof params.on !== "boolean") throw new Error("say on, true or false");
      if (params.on) await hooks.start();
      return { claude: await setClaudeHook({ claudeHome, kyurenHome, relay: BUILT, on: params.on }), listening: hooks.listening() };
    },
  };
}
