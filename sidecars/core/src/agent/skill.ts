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

/// Using one of the skills Kyuren has been given.
///
/// Declared as reaching out of the machine, and described by where it reaches rather than by its
/// own name, so what is being agreed to is which host may be talked to.
export function skillTool(resolve: Resolve = lookupAll): Tool<z.infer<typeof skillSchema>> {
  // The approval each call was asked about under, so a skill approved again while the question was
  // open, which may reach somewhere else, is not called on the strength of it.
  const describedUnder = new WeakMap<object, number | undefined>();
  return {
    name: "skill",
    description:
      "Use one of the approved skills. Give its name and the values it asks for. Only approved "
      + "skills can be used; a skill that is pending or broken will refuse.",
    describe: (args) => {
      const found = sharedSkills().named(args.name);
      describedUnder.set(args, found?.approved);
      return {
        tool: "skill",
        effect: "outbound",
        target: whereItGoes(args.name),
        carrying: Object.entries(args.values).map(([name, value]) => `${name}: ${value}`).join(", "),
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
      if (!ran.ok) {
        return {
          ok: false,
          reason: ran.reason,
          // Said plainly rather than tried again, so a skill that has stopped working is known
          // to have stopped working.
          spoken: ran.broke ? `${found.name} has stopped working: ${ran.reason}` : undefined,
        };
      }
      return { ok: true, status: ran.status, read: ran.read };
    },
  };
}
