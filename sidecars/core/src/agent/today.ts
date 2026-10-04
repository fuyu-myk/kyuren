import { z } from "zod";
import type { Ask, Tool } from "#agent/tool.ts";
import { asFacts, digest } from "#brief/digest.ts";
import { asSpeech, type Scope } from "#brief/speech.ts";
import { writeNote } from "#brief/vault.ts";
import { gather } from "#connect/read.ts";
import { spanAround, type Source } from "#connect/source.ts";
import type { Gate } from "#permission/gate.ts";

export const todaySchema = z.object({
  when: z
    .enum(["today", "tomorrow", "everything"])
    .optional()
    .describe(
      "Which part of the day the user asked about. Use \"tomorrow\" only when they asked about "
      + "tomorrow, \"today\" when they asked only about today, and \"everything\" for a general "
      + "brief or anything about deadlines or mail.",
    ),
});

/// The tool itself reaches nothing. Each connected service is judged separately inside, so the
/// gate asks about the sources rather than about the asking.
export function todayTool(
  sources: Source[],
  back: number,
  forward: number,
  gate: Gate,
  ask: Ask,
  vault: string,
): Tool<z.infer<typeof todaySchema>> {
  return {
    name: "today",
    description:
      "What the user's day holds: their calendar for today and tomorrow, deadlines coming up, "
      + "work that is overdue, and unread mail. Call this for any question about their schedule, "
      + "their day, what is due, what is coming up, or a morning brief.",
    describe: () => ({ tool: "today", effect: "read", target: "the day" }),
    notes: true,
    run: async (args, signal) => {
      const gathered = await gather(sources, spanAround(new Date(), back, forward), gate, (action, why) => ask(action, why, signal));
      const summary = digest(gathered);

      // The day is written down as it is read. A brief that only spoke would leave nothing to look
      // at later, and the note is the user's to edit afterwards.
      const note = await writeNote(vault, summary, gathered.read).catch(() => undefined);

      const scope = (args.when ?? "everything") as Scope;
      return {
        facts: asFacts(summary, scope),
        spoken: asSpeech(summary, scope),
        read: gathered.read,
        note,
      };
    },
  };
}
