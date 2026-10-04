import { randomUUID } from "node:crypto";
import type { Ask } from "#agent/tool.ts";
import type { Action } from "#permission/action.ts";
import type { Transport } from "#transport.ts";

export type Asker = {
  ask: Ask;
  answer: (id: string, verdict: "allow" | "deny") => boolean;
  pending: () => number;
};

/// Puts the question to whoever is driving the sidecar and waits. A question nobody answers stays
/// unanswered rather than timing out into an approval.
export function createAsker(transport: Transport): Asker {
  const waiting = new Map<string, (verdict: "allow" | "deny") => void>();

  return {
    ask: (action: Action, why?: string, signal?: AbortSignal) =>
      new Promise<"allow" | "deny">((resolve) => {
        if (signal?.aborted) {
          resolve("deny");
          return;
        }
        const id = randomUUID();
        // What asked was stopped: the question is no longer waiting, in either window.
        const withdraw = () => {
          if (!waiting.delete(id)) return;
          transport.send({ event: "permission.withdrawn", data: { id } });
          resolve("deny");
        };
        waiting.set(id, (verdict) => {
          signal?.removeEventListener("abort", withdraw);
          resolve(verdict);
        });
        signal?.addEventListener("abort", withdraw, { once: true });
        transport.send({
          event: "permission.request",
          data: {
            id,
            tool: action.tool,
            effect: action.effect,
            target: action.target,
            ...(action.carrying ? { carrying: action.carrying } : {}),
            ...(why ? { why } : {}),
          },
        });
      }),

    answer: (id, verdict) => {
      const resolve = waiting.get(id);
      if (!resolve) return false;
      waiting.delete(id);
      resolve(verdict);
      return true;
    },

    pending: () => waiting.size,
  };
}
