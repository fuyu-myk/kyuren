import { homedir } from "node:os";
import { join } from "node:path";
import { run } from "#agent/loop.ts";
import { createAsker, type Asker } from "#agent/asker.ts";
import { watchedOver } from "#agent/watched.ts";
import { briefHandlers } from "#methods/brief.ts";
import { playbookHandlers } from "#methods/playbook.ts";
import { researchHandlers } from "#methods/research.ts";
import { ROUTES, type Route } from "#model/route.ts";
import { sharedGate } from "#permission/shared.ts";
import { sharedSessions } from "#session/shared.ts";
import { answered, opened } from "#session/thread.ts";
import type { Transport } from "#transport.ts";

const root = process.env.KYUREN_HOME ?? join(homedir(), ".kyuren");
const vault = process.env.KYUREN_VAULT ?? join(root, "vault");

const LEVELS = ["trivial", "moderate", "hard"] as const;

function routeIn(given: unknown): Route | undefined {
  return ROUTES.find((one) => one === given);
}

function difficultyIn(given: unknown): (typeof LEVELS)[number] | undefined {
  return LEVELS.find((level) => level === given);
}

/// A session is named after the thing that started it, until someone names it better.
function titleOf(prompt: string): string {
  return prompt.split("\n")[0]!.trim() || "new session";
}

export function agentHandlers(transport: Transport) {
  const asker: Asker = createAsker(transport);
  const gate = sharedGate();
  const running = new Map<string, AbortController>();

  return {
    ...briefHandlers(gate, asker.ask, vault),
    ...playbookHandlers(gate, asker.ask, vault, () => watchedOver(transport)),
    ...researchHandlers(vault),

    "agent.run": async (params: Record<string, unknown>) => {
      const prompt = params.prompt;
      if (typeof prompt !== "string" || prompt.trim() === "") {
        throw new Error("agent.run needs a prompt");
      }

      const id = typeof params.id === "string" ? params.id : "default";

      // A turn either belongs to a session or it does not. Spoken turns do not, which is why this
      // is asked for rather than assumed: the orb is a conversation that is over when it is over.
      const sessions = sharedSessions();
      const thread = opened(sessions, params.session, params.pane, prompt, titleOf(prompt));
      const preferred = routeIn(params.route);

      running.get(id)?.abort();
      const controller = new AbortController();
      running.set(id, controller);

      try {
        const transcript = await run({
          prompt,
          vault,
          history: thread.history,
          exposed: thread.exposed,
          system: typeof params.system === "string" ? params.system : undefined,
          sensitive: params.sensitive === true,
          // Left unset when the caller did not say, so the request is judged rather than assumed.
          // Defaulting here meant every turn arrived pre-labelled and the router never ran.
          difficulty: difficultyIn(params.difficulty),
          preferred,
          gate,
          ask: asker.ask,
          signal: controller.signal,
          onText: (chunk) =>
            transport.send({ event: "agent.text", data: { id, chunk } }),
          watching: watchedOver(transport, id),
        });

        answered(
          sessions,
          thread,
          transcript.text,
          { model: transcript.model, route: transcript.route, usage: transcript.usage },
          transcript.exposed === true,
        );
        // The choice is the conversation's from then on. Only a caller who spoke of a choice at
        // all makes one; the orb never does, and must not clear what the window chose.
        if (thread.session && "route" in params) sessions.prefer(thread.session.id, preferred);
        return { ...transcript, session: thread.session?.id };
      } finally {
        running.delete(id);
      }
    },

    "agent.stop": async (params: Record<string, unknown>) => {
      const id = typeof params.id === "string" ? params.id : "default";
      const controller = running.get(id);
      controller?.abort();
      return { stopped: Boolean(controller) };
    },

    "permission.answer": async (params: Record<string, unknown>) => {
      const id = params.id;
      const verdict = params.verdict;
      if (typeof id !== "string" || (verdict !== "allow" && verdict !== "deny")) {
        throw new Error("permission.answer needs an id and a verdict of allow or deny");
      }
      return { matched: asker.answer(id, verdict), pending: asker.pending() };
    },
  };
}
