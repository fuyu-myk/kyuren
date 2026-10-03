import { randomUUID } from "node:crypto";
import type { Watching } from "#agent/loop.ts";
import type { Transport } from "#transport.ts";

/// Tells whoever drives this process each step a run takes, as it begins and as it ends, under
/// one id for the run. The island's work tab and the mind's live layer are both drawn from these.
export function watchedOver(transport: Transport, id: string = randomUUID()): Watching {
  let steps = 0;
  return {
    began: (tool, target) => {
      const step = `step:${id}:${(steps += 1)}`;
      transport.send({ event: "agent.step", data: { id, step, tool, target } });
      return step;
    },
    ended: (step, ok) => transport.send({ event: "agent.step.done", data: { id, step, ok } }),
  };
}
