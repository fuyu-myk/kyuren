import { z } from "zod";
import type { Tool } from "#agent/tool.ts";
import { recapDay } from "#recap/evening.ts";
import { recapNote, recapSpeech } from "#recap/say.ts";

export const recapSchema = z.object({});

/// The day's work, read from the user's own repositories, from GitHub as they signed in, and from
/// the island's record and Claude Code's, and written into the day's note as it is told.
export function recapTool(vault: string, day: typeof recapDay = recapDay): Tool<z.infer<typeof recapSchema>> {
  return {
    name: "recap",
    description:
      "How the user's working day went: what they committed across their repositories, their pull "
      + "requests merged, what they decided on the island, and where Claude Code worked. Call this "
      + "when they ask how today went, what they got done, or for an evening recap.",
    describe: () => ({ tool: "recap", effect: "read", target: "the day's work" }),
    run: async () => {
      const { recap, note } = await day(vault);
      return { facts: recapNote(recap), spoken: recapSpeech(recap), note };
    },
  };
}
