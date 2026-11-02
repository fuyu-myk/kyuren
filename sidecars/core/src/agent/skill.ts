import { z } from "zod";
import type { Tool } from "#agent/tool.ts";
import { lookupAll, type Resolve } from "#connect/web/nearby.ts";
import { runSkill } from "#skill/run.ts";
import { untried } from "#skill/shape.ts";
import { sharedSkills } from "#skill/shared.ts";

export const skillSchema = z.object({
  name: z.string().describe("the name of an approved skill"),
  values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .describe("the parameters the skill asks for"),
});

function whereItGoes(name: string): string {
  const found = sharedSkills().named(name);
  if (!found) return name;
  try {
    return new URL(found.url.replace(/\{[a-zA-Z][a-zA-Z0-9_]*\}/g, "x")).origin;
  } catch {
    return name;
  }
}

/// The approved skills by name, what each does and what it takes, read as each turn begins, so a
/// skill approved since the last is one the model knows to reach for.
function described(): string {
  const told = "Use one of the approved skills. Give its name and the values it asks for. Only approved "
    + "skills can be used; a skill that is pending or broken will refuse.";
  const approved = sharedSkills().list().filter((one) => one.state === "approved");
  if (approved.length === 0) return `${told} None is approved yet.`;
  const each = approved.map((one) => {
    const takes = one.parameters.map((given) => `${given.name} (${given.kind}${given.required ? ", needed" : ""})`);
    return `- ${one.name}: ${one.about}${takes.length > 0 ? ` It takes ${takes.join(", ")}.` : ""}`;
  });
  return [told, "The approved skills:", ...each].join("\n");
}

const TESTING = "Try one of the approved skills with sample values, to see whether it works and what its "
  + "answer holds. Use it to check a skill once it is approved or changed, before relying on it. A "
  + "failure marks the skill broken, with the reason, until it is mended and approved again.";

/// What an answer holds, by name and kind, a few levels down: enough to see whether a skill
/// answers with what it is meant to, without the whole answer read for it.
function holds(value: unknown, depth = 3): unknown {
  if (Array.isArray(value)) return value.length > 0 && depth > 0 ? [holds(value[0], depth - 1)] : [];
  if (value !== null && typeof value === "object") {
    if (depth === 0) return "object";
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, holds(inner, depth - 1)]));
  }
  return value === null ? "null" : typeof value;
}

/// Using one of the skills Kyuren has been given, or trying one to see that it works.
///
/// Declared as reaching out of the machine, and described by where it reaches rather than by its
/// own name, so what is being agreed to is which host may be talked to. A try is a call like any
/// other, and reaches only what has been approved.
export function skillTool(resolve: Resolve = lookupAll, use: "use" | "test" = "use"): Tool<z.infer<typeof skillSchema>> {
  const name = use === "test" ? "skill_test" : "skill";
  // The approval each call was asked about under, so a skill approved again while the question was
  // open, which may reach somewhere else, is not called on the strength of it.
  const describedUnder = new WeakMap<object, number | undefined>();
  return {
    name,
    description: use === "test" ? TESTING : described(),
    describe: (args) => {
      const found = sharedSkills().named(args.name);
      describedUnder.set(args, found?.approved);
      return {
        tool: name,
        effect: "outbound",
        target: whereItGoes(args.name),
        // Named, since the host alone does not say which skill is about to be called.
        carrying: `${args.name} with ${Object.entries(args.values).map(([name, value]) => `${name}: ${value}`).join(", ") || "nothing"}`,
        ...(found && untried(found) ? { first: `${found.name} has not been used since it was approved` } : {}),
      };
    },
    run: async (args) => {
      const skills = sharedSkills();
      const found = skills.named(args.name);
      if (!found) return { ok: false, reason: `there is no skill called ${args.name}` };
      if (found.state === "approved") {
        if (!describedUnder.has(args) || describedUnder.get(args) !== found.approved) {
          return { ok: false, reason: `${found.name} changed while it was being asked about; use it again to be asked about it as it is now` };
        }
        // Reached only past the gate, which asks about an untried skill whatever its host was allowed.
        if (untried(found) && found.approved !== undefined) skills.confirm(found.id, found.approved);
      }

      const ran = await runSkill(skills, found.id, args.values, resolve);
      if (use === "test") {
        return ran.ok
          ? { worked: true, status: ran.status, holds: holds(ran.read), answer: ran.read }
          : { worked: false, reason: ran.reason, broke: ran.broke };
      }
      if (!ran.ok) {
        return {
          ok: false,
          reason: ran.reason,
          // Said plainly rather than tried again, so a skill that has stopped working is known
          // to have stopped working.
          spoken: ran.broke ? `${found.name} has stopped working: ${ran.reason}` : undefined,
        };
      }
      // Only the values it takes are kept, so nothing planted beside them is offered again.
      const takes = new Set(found.parameters.map((one) => one.name));
      skills.used(found.id, Object.fromEntries(Object.entries(args.values).filter(([name]) => takes.has(name))));
      return { ok: true, status: ran.status, read: ran.read };
    },
  };
}
