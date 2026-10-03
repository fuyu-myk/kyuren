import { z } from "zod";
import type { Tool } from "#agent/tool.ts";
import { faults, KINDS, METHODS, WHERE, type Auth, type Draft } from "#skill/shape.ts";
import { sharedSkills } from "#skill/shared.ts";

/// Flat, and everything but the request itself optional.
///
/// This was a shape of nested unions to begin with, and a small model could not fill it in: it
/// spent its turn being told its `auth` object was wrong and gave up without writing anything
/// down. What the model has to produce is kept as plain as the thing allows.
export const forgeSchema = z.object({
  name: z.string().describe("a short lower case name, as a tool would be named"),
  about: z.string().describe("what this does, in a sentence it can be chosen by"),
  method: z.enum(METHODS).default("GET"),
  url: z.string().describe("the https address, with {placeholders} for path parameters"),
  parameters: z
    .array(z.object({
      name: z.string(),
      in: z.enum(WHERE).describe("path, query, header or body"),
      kind: z.enum(KINDS).default("string"),
      required: z.boolean().default(false),
      about: z.string().default(""),
    }))
    .default([]),
  headers: z.record(z.string(), z.string()).default({}).describe("fixed headers, never a credential"),
  reads: z.enum(["json", "text"]).default("json"),
  auth: z
    .enum(["none", "bearer", "header", "query"])
    .default("none")
    .describe("how the endpoint is authenticated; none for one that needs no key"),
  credential: z
    .string()
    .default("")
    .describe("when it needs a key: the name of the keychain entry to use, never the key itself"),
  authHeader: z.string().default("").describe("when auth is header: which header the key goes in"),
  authQuery: z.string().default("").describe("when auth is query: which parameter the key goes in"),
});

function authOf(args: z.infer<typeof forgeSchema>): Auth {
  const credential = args.credential.trim();
  if (args.auth === "bearer") return { mode: "bearer", credential };
  if (args.auth === "header") {
    return { mode: "header", credential, header: args.authHeader.trim() || "x-api-key" };
  }
  if (args.auth === "query") {
    return { mode: "query", credential, query: args.authQuery.trim() || "key" };
  }
  return { mode: "none" };
}

/// Writing down a new thing Kyuren could do.
///
/// It is inert. Drafting cannot approve, and there is nothing here that can: the skill appears in
/// the window as pending and stays that way until a person says otherwise.
export function forgeTool(): Tool<z.infer<typeof forgeSchema>> {
  return {
    name: "forge",
    description:
      "Write down a new skill: one request to one https endpoint, with typed parameters. Use this "
      + "when you have found an endpoint worth keeping. The skill is inert until the user "
      + "approves it, so draft it and then say that it is waiting to be approved.",
    describe: (args) => ({ tool: "forge", effect: "write", target: `skill ${args.name}` }),
    run: async (args) => {
      const skills = sharedSkills();
      const draft: Draft = {
        name: args.name,
        about: args.about,
        method: args.method,
        url: args.url,
        parameters: args.parameters,
        headers: args.headers,
        auth: authOf(args),
        reads: args.reads,
      };

      const wrong = faults(draft, skills.names());
      if (wrong.length > 0) return { drafted: false, wrong };

      const made = skills.draft(draft);
      return {
        drafted: true,
        id: made.id,
        name: made.name,
        state: made.state,
        spoken: `${made.name} is drafted and waiting to be approved. It is not callable yet.`,
      };
    },
  };
}
