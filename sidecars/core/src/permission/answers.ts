import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { EFFECTS, type Action } from "#permission/action.ts";

/// One answer the user gave at the keyboard, with the action it was about, so the file reads as
/// a list of what they said rather than a list of hashes.
export type Answer = {
  action: Action;
  verdict: "allow" | "deny";
  at: string;
};

/// Where answers are kept between runs of the core.
export type Keeper = {
  read: () => Answer[];
  write: (answers: Answer[]) => void;
};

const answerSchema = z.object({
  action: z.object({ tool: z.string().min(1), effect: z.enum(EFFECTS), target: z.string() }),
  verdict: z.enum(["allow", "deny"]),
  at: z.string(),
});

/// One plain JSON file, the user's to read and to edit: removing a line is withdrawing that
/// answer. A file that does not parse is no answers, and every question is asked again.
export function fileKeeper(path: string): Keeper {
  return {
    read: () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(path, "utf8"));
      } catch {
        return [];
      }
      if (!Array.isArray(parsed)) return [];
      return parsed.flatMap((one) => {
        const result = answerSchema.safeParse(one);
        return result.success ? [result.data] : [];
      });
    },
    write: (answers) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${JSON.stringify(answers, null, 2)}\n`, "utf8");
    },
  };
}
