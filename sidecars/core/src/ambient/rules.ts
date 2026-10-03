import { readFileSync } from "node:fs";
import { z } from "zod";

/// What the user has said may reach them without being asked. Each rule names one kind of thing
/// and whether it may speak; anything without a rule stays silent, which is the whole point.
const rule = z.discriminatedUnion("when", [
  z.object({
    id: z.string().min(1),
    when: z.literal("event"),
    /// Minutes before it starts.
    within: z.number().int().positive().max(1440),
    voice: z.boolean().default(false),
  }),
  z.object({
    id: z.string().min(1),
    when: z.literal("message"),
    /// A subject must contain this, case aside, to count. Without it every message counts.
    matching: z.string().min(1).optional(),
    voice: z.boolean().default(false),
  }),
  z.object({
    id: z.string().min(1),
    when: z.literal("task"),
    voice: z.boolean().default(false),
  }),
]);

export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Day = (typeof DAYS)[number];

/// A playbook run at a time of day, on the days named, without anyone asking for it. Writing one
/// here is the permission to run that playbook unattended, as naming a source is the permission
/// to read it; a question the run would have asked is refused, and the run's log says so.
const schedule = z.object({
  id: z.string().min(1),
  playbook: z.string().min(1),
  /// A time of day in the machine's own clock, as 07:30.
  at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "a time of day, as 07:30"),
  /// The days it runs on; every day when left out.
  on: z.array(z.enum(DAYS)).min(1).optional(),
  /// Inputs given outright. What can be derived, a slug or the week, is filled in.
  inputs: z.record(z.string(), z.string()).default({}),
  /// The pane its conversation is kept in.
  pane: z.string().min(1).default("chat"),
  voice: z.boolean().default(false),
});

export const rulesSchema = z.object({
  enabled: z.boolean().default(false),
  /// Minutes between looks.
  every: z.number().int().positive().max(1440).default(5),
  /// The sources this file may read, by name. Writing a source here is the permission to read it
  /// unattended: nothing else grants that, and nothing not written here is read.
  read: z.array(z.string().min(1)).default([]),
  rules: z.array(rule).default([]),
  schedules: z.array(schedule).default([]),
});

export type Rule = z.infer<typeof rule>;
export type Schedule = z.infer<typeof schedule>;
export type Rules = z.infer<typeof rulesSchema>;

export const NONE: Rules = { enabled: false, every: 5, read: [], rules: [], schedules: [] };

export type Read = {
  rules: Rules;
  trouble?: string;
};

function twiceIn(named: Array<{ id: string }>): string | undefined {
  const ids = named.map((one) => one.id);
  return ids.find((id, at) => ids.indexOf(id) !== at);
}

/// Read fresh every time, so editing the file is the whole act of changing the rules. A file that
/// does not parse is not a partly working set of rules: it is no rules at all, and it says why.
export function readRules(path: string): Read {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return { rules: NONE };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (failure) {
    return { rules: NONE, trouble: `not JSON: ${failure instanceof Error ? failure.message : String(failure)}` };
  }

  const result = rulesSchema.safeParse(parsed);
  if (!result.success) {
    const said = result.error.issues.map((issue) => `${issue.path.join(".") || "file"}: ${issue.message}`);
    return { rules: NONE, trouble: said.join("; ") };
  }

  const rule = twiceIn(result.data.rules);
  if (rule) return { rules: NONE, trouble: `two rules are called ${rule}` };
  const schedule = twiceIn(result.data.schedules);
  if (schedule) return { rules: NONE, trouble: `two schedules are called ${schedule}` };

  return { rules: result.data };
}
