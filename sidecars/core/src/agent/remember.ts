import { z } from "zod";
import type { Tool } from "#agent/tool.ts";
import type { Memory } from "#memory/memory.ts";

export const rememberSchema = z.object({
  question: z.string().describe("what to look for, in the user's own words"),
});

const SOME = 5;

/// Enough to hold everything written about one person across a term of notes, which a handful
/// cannot, without reading the vault into a turn.
const ABOUT_SOMEONE = 10;

/// Reading the user's own notes. They are on this machine and were written by the user, so this
/// asks nobody: the gate exists for what leaves the machine or changes something.
export function rememberTool(memory: Memory): Tool<z.infer<typeof rememberSchema>> {
  return {
    name: "remember",
    description:
      "Search the user's own notes and past days for something they have written down. Use this "
      + "for anything personal that is not today's calendar: people, decisions, readings, "
      + "what happened on an earlier day, or anything they said to remember.",
    describe: (args) => ({ tool: "remember", effect: "read", target: args.question }),
    notes: true,
    run: async (args) => {
      const about = memory.named(args.question);
      const found = await memory.recall(args.question, about.length ? ABOUT_SOMEONE : SOME);
      return {
        about: about.map((one) => one.name),
        found: found.map((one) => ({ from: one.file, heading: one.heading, text: one.text })),
      };
    },
  };
}
