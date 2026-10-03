import { z } from "zod";
import type { Tool } from "#agent/tool.ts";
import { matched } from "#projects/recall.ts";
import { sharedBoard } from "#projects/shared.ts";
import { spawnSession } from "#projects/spawn.ts";

export const codeSchema = z.object({
  project: z.string().describe("the repository the work belongs to"),
  asking: z.string().describe("what the coding session should look into, in full"),
});

/// Sending a coding session into one repository.
///
/// Declared as running something rather than reading something, so the gate asks first: the user
/// sees which repository and what it is being asked before anything starts.
export function codeTool(): Tool<z.infer<typeof codeSchema>> {
  return {
    name: "code",
    description:
      "Send a coding session into one of the user's repositories to look into something and "
      + "report back. It reads and plans; it does not change anything. Use this when a question "
      + "needs someone to actually look at the code rather than at its history.",
    describe: (args) => ({ tool: "code", effect: "execute", target: `${args.project}: ${args.asking}` }),
    run: async (args, signal) => {
      const found = matched(await sharedBoard().projects(), args.project);
      if (!found) return { found: false, reason: `there is no project called ${args.project}` };

      const done = await spawnSession(found, args.asking, signal);
      return {
        found: true,
        project: done.project,
        ranIn: done.path,
        ok: done.ok,
        spoken: done.said,
        turns: done.turns,
        seconds: Math.round(done.elapsedMs / 1000),
      };
    },
  };
}
