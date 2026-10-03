import { z } from "zod";
import type { Tool } from "#agent/tool.ts";
import { matched, recall, summarise } from "#projects/recall.ts";
import { sharedBoard } from "#projects/shared.ts";

export const projectSchema = z.object({
  name: z.string().describe("the project or repository being asked about"),
});

function on(at: number | undefined): string | undefined {
  return at === undefined ? undefined : new Date(at).toISOString().slice(0, 10);
}

/// Where a project stood when work on it stopped.
///
/// Reading the user's own repositories asks nobody, for the same reason reading their notes does
/// not: it is theirs, it is on this machine, and nothing leaves it.
export function projectTool(): Tool<z.infer<typeof projectSchema>> {
  return {
    name: "project",
    description:
      "Where a project stood when work on it last stopped: what it is, which branch it is on, "
      + "what was left uncommitted or unpushed, when it was last touched, and what the last "
      + "commits were about. Use this for any question about a repository, a codebase or a piece "
      + "of work, however long ago it was.",
    describe: (args) => ({ tool: "project", effect: "read", target: args.name }),
    run: async (args) => {
      const projects = await sharedBoard().projects();
      const found = matched(projects, args.name);
      if (!found) {
        return {
          found: false,
          // Said rather than guessed at, so the answer can name what is actually there.
          projects: projects.slice(0, 15).map((one) => one.name),
        };
      }

      const held = await recall(found);
      return {
        found: true,
        // Composed here and spoken as it is: what someone coming back after six months wants is
        // the last few commit subjects, and a small model asked to retell them leaves them out.
        spoken: summarise(held),
        name: held.project.name,
        about: held.about,
        branch: held.project.branch,
        neverPushed: held.project.upstream === undefined,
        uncommitted: held.project.dirty,
        unpushed: held.project.ahead,
        behind: held.project.behind,
        lastTouched: on(held.project.lastAt),
        lately: held.lately.map((one) => ({ on: on(one.at), said: one.said })),
      };
    },
  };
}
