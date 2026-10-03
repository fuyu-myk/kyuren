import { z } from "zod";
import type { Tool } from "#agent/tool.ts";
import { addPage } from "#connect/notion/write.ts";
import { databases, pageAddress } from "#connect/notion/places.ts";

export const noteSchema = z.object({
  database: z.string().describe("the name of the Notion database to add to"),
  title: z.string().describe("what the entry says"),
  date: z.string().optional().describe("an ISO date, if the entry is due or happens on a day"),
});

function idFor(name: string): string | undefined {
  const wanted = name.trim().toLowerCase();
  const all = databases();
  return (all.find((one) => one.title.toLowerCase() === wanted)
    ?? all.find((one) => one.title.toLowerCase().includes(wanted)))?.id;
}

/// Adding something to Notion. Which database decides whether this is refused, asked about or
/// simply done, the same way a folder does, so one workspace can hold notes Kyuren keeps and notes
/// it may only read.
export const noteTool: Tool<z.infer<typeof noteSchema>> = {
  name: "add_to_notion",
  description:
    "Add one entry to a Notion database: a task, an assignment, a note. Say which database by "
    + "name. Use this when the user asks to remember, add, or schedule something in Notion.",
  describe: (args) => ({
    tool: "add_to_notion",
    effect: "write",
    // Named by where it lands. A database that is not known is still addressed, so the gate judges
    // it rather than the tool quietly deciding what to do about it.
    target: pageAddress(idFor(args.database) ?? `unknown/${args.database}`, "new"),
    carrying: args.date ? `${args.title} (${args.date})` : args.title,
  }),
  run: async (args) => {
    const id = idFor(args.database);
    if (!id) {
      const known = databases().map((one) => one.title);
      throw new Error(
        known.length === 0
          ? "no Notion databases are known yet"
          : `no database called "${args.database}". Known: ${known.join(", ")}`,
      );
    }
    return addPage({ databaseId: id, title: args.title, date: args.date });
  },
};
