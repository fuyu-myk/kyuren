import { z } from "zod";
import { authOf, parametersSchema } from "#agent/forge.ts";
import type { Tool } from "#agent/tool.ts";
import { faults, METHODS, type Draft } from "#skill/shape.ts";
import { sharedSkills } from "#skill/shared.ts";

/// Only what is to change is given; everything left out stays as it is.
export const editSchema = z.object({
  name: z.string().describe("the skill to change"),
  why: z.string().describe("what is wrong with it now, or what this makes better, in a sentence the user reads before approving it again"),
  about: z.string().optional(),
  method: z.enum(METHODS).optional(),
  url: z.string().optional().describe("the https address, with {placeholders} for path parameters"),
  parameters: parametersSchema.optional().describe("the whole list as it should be"),
  headers: z.record(z.string(), z.string()).optional().describe("fixed headers, never a credential"),
  reads: z.enum(["json", "text"]).optional(),
  auth: z.enum(["none", "bearer", "header", "query"]).optional(),
  credential: z.string().optional().describe("the name of the keychain entry to use, never the key itself"),
  authHeader: z.string().optional(),
  authQuery: z.string().optional(),
});

const FIELDS = ["about", "method", "url", "parameters", "headers", "reads", "auth"] as const;

function draftOf(skill: Draft): Draft {
  return { name: skill.name, about: skill.about, method: skill.method, url: skill.url, parameters: skill.parameters, headers: skill.headers, auth: skill.auth, reads: skill.reads };
}

/// Changing a skill Kyuren already has: mending one that broke, or making one do better.
///
/// A changed skill goes back to pending, with what was approved kept beside it and the reason given,
/// so nothing changed runs until the user has seen the change and approved it again.
export function editTool(): Tool<z.infer<typeof editSchema>> {
  return {
    name: "skill_edit",
    description:
      "Change a skill Kyuren already has, giving only what is to change and why. Use it to mend a "
      + "skill that broke or to make one do better, after testing it or reading its documentation. "
      + "The skill waits to be approved again before it can be used, so say that it is waiting.",
    describe: (args) => ({ tool: "skill_edit", effect: "write", target: `skill ${args.name}` }),
    run: async (args) => {
      const skills = sharedSkills();
      const found = skills.named(args.name);
      if (!found) return { revised: false, wrong: [`there is no skill called ${args.name}`] };

      const was = draftOf(found);
      const keyed = args.auth !== undefined || args.credential !== undefined || args.authHeader !== undefined || args.authQuery !== undefined;
      const draft: Draft = {
        ...was,
        about: args.about ?? was.about,
        method: args.method ?? was.method,
        url: args.url ?? was.url,
        parameters: args.parameters ?? was.parameters,
        headers: args.headers ?? was.headers,
        reads: args.reads ?? was.reads,
        auth: keyed
          ? authOf({
            auth: args.auth ?? was.auth.mode,
            credential: args.credential ?? ("credential" in was.auth ? was.auth.credential : ""),
            authHeader: args.authHeader ?? (was.auth.mode === "header" ? was.auth.header : ""),
            authQuery: args.authQuery ?? (was.auth.mode === "query" ? was.auth.query : ""),
          })
          : was.auth,
      };

      const changed = FIELDS.filter((field) => JSON.stringify(draft[field]) !== JSON.stringify(was[field]));
      if (changed.length === 0) return { revised: false, wrong: ["nothing about it would change"] };
      const wrong = faults(draft, skills.names().filter((one) => one !== found.name));
      if (wrong.length > 0) return { revised: false, wrong };

      skills.revise(found.id, draft, Date.now(), args.why.trim());
      return {
        revised: true,
        name: found.name,
        state: "pending",
        changed,
        spoken: `${found.name} is changed and waiting to be approved again. It is not callable until then.`,
      };
    },
  };
}
