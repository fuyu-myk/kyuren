import { z } from "zod";
import type { Tool } from "#agent/tool.ts";
import { openLink, promptOf, sessionLink, type Opener } from "#coding/start.ts";
import { matched } from "#projects/recall.ts";
import { sharedBoard } from "#projects/shared.ts";
import type { Project } from "#projects/state.ts";

export const startSchema = z.object({
  project: z.string().describe("the repository the session works in"),
  prompt: z.string().describe("what the session is asked to do, in full, in the user's words"),
});

/// Opening a new Claude Code session in the Claude app, in one repository, with a request in it.
///
/// Declared as running something, so the gate asks first: the user sees which repository and what
/// the session will be asked before the app opens it.
export function startTool(
  projects: () => Promise<Project[]> = () => sharedBoard().projects(),
  open: Opener = openLink,
): Tool<z.infer<typeof startSchema>> {
  return {
    name: "start_coding_session",
    description:
      "Open a new Claude Code session in the Claude app, in one of the user's repositories, with "
      + "the request in its prompt. Use this when the user wants work started in a repository, "
      + "such as fixing a failing test, rather than an answer about it.",
    describe: (args) => ({ tool: "start_coding_session", effect: "execute", target: `${args.project}: ${args.prompt}` }),
    run: async (args) => {
      const found = matched(await projects(), args.project);
      if (!found) return { started: false, reason: `there is no project called ${args.project}` };
      const prompt = promptOf(args.prompt);
      if (prompt === undefined) return { started: false, reason: "that request cannot be handed to a session as it is" };

      await open(sessionLink(found.path, prompt));
      return { started: true, project: found.name, in: found.path };
    },
  };
}
