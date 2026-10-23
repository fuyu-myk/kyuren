import { z } from "zod";
import { waited, type Answer, type Ask, type Field, type Wait } from "#coding/asked.ts";
import { HIDING, projectOf } from "#coding/shown.ts";

/// A form with more fields than this is for its own dialog.
export const FIELDS = 8;
/// The longest value typed into a form on the island.
export const VALUE_MOST = 2_000;

/// What a form may not ask for on the island: anything that reads as a secret, matched on its words.
/// Typed into a notch, it would be typed where nothing keeps it hidden.
const SECRET =
  /\b(pass(word|code|phrase)?|pwd?|secrets?|tokens?|(api|access|private|secret|signing|license|ssh|gpg|pgp) keys?|credentials?|bearer|cookies?|pins?|otp|totp|hotp|mfa|2fa|cvv|cvc|card numbers?|credit cards?|ssn|social security|seed( phrase)?|mnemonic|recovery (codes?|phrases?|keys?)|(verification|security|auth|one time) codes?)\b/;

/// Text as its words, however they are written or joined: full width or not, in camel case, or with
/// underscores, hyphens or dots between them.
function words(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/([a-z])([A-Z0-9])/g, "$1 $2")
    .replace(/[_.-]+/g, " ")
    .toLowerCase();
}

/// Letters of the scripts drawn like Latin ones, in a word with Latin letters: "Раssword" spells its
/// first two in Cyrillic, so that it reads as what a check of its words would not find.
const LATIN = /\p{Script=Latin}/u;
const LOOKALIKE = /[\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Armenian}\p{Script=Cherokee}]/u;

function disguised(text: string): boolean {
  return text
    .normalize("NFKC")
    .split(/[^\p{L}\p{M}]+/u)
    .some((word) => LATIN.test(word) && LOOKALIKE.test(word));
}

/// What a value typed on the island may not hold: a line break, an escape or another control
/// character. Anything else the user can type, a wide space or an emoji among them, is theirs.
const CONTROL = /\p{Cc}/u;

/// A field as the island shows and checks it, and nothing beside: one with a rule it does not
/// check, a format, a pattern or names shown in place of its choices, is for Claude Code's dialog.
const PROPERTY = z.strictObject({
  type: z.enum(["string", "number", "integer", "boolean"]),
  title: z.string().max(120).optional(),
  description: z.string().max(300).optional(),
  enum: z.array(z.string().min(1).max(120)).min(1).max(12).optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  minLength: z.number().int().min(0).optional(),
  maxLength: z.number().int().min(0).optional(),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
});

const ELICITATION = z.object({
  session_id: z.string().min(1).max(200),
  cwd: z.string().min(1).max(4096),
  mcp_server_name: z.string().min(1).max(200),
  message: z.string().min(1).max(600),
  mode: z.enum(["form", "url"]).optional(),
  requested_schema: z.object({
    type: z.literal("object"),
    properties: z.record(z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/), PROPERTY),
    required: z.array(z.string()).optional(),
  }),
});

/// A form one of Claude Code's servers asks to have filled in, as the island shows it: one of plain
/// fields, none of them reading as a secret, or nothing, so that Claude Code shows its own dialog. A
/// request to open a page in the browser is always left to Claude Code.
export function claudeForm(payload: unknown, id: string, now: number, wait: Wait): Ask | undefined {
  const parsed = ELICITATION.safeParse(payload);
  if (!parsed.success || parsed.data.mode === "url") return undefined;
  const { session_id: session, cwd, mcp_server_name: server, message, requested_schema: schema } = parsed.data;
  const project = projectOf(cwd);
  const entries = Object.entries(schema.properties);
  if (project === undefined || entries.length === 0 || entries.length > FIELDS) return undefined;
  if (entries.some(([, property]) => property.enum !== undefined && property.type !== "string")) return undefined;
  const required = new Set(schema.required ?? []);
  const fields: Field[] = entries.map(([name, property]) => {
    const [least, most] = property.type === "string" ? [property.minLength, property.maxLength] : [property.minimum, property.maximum];
    return {
      name,
      title: property.title ?? name,
      about: property.description ?? "",
      type: property.type,
      choices: property.enum ?? [],
      required: required.has(name),
      ...(property.type === "boolean" || least === undefined ? {} : { least }),
      ...(property.type === "boolean" || most === undefined ? {} : { most }),
    };
  });
  const shown = [server, message, ...fields.flatMap((field) => [field.name, field.title, field.about, ...field.choices])];
  if (shown.some((one) => HIDING.test(one))) return undefined;
  const asked = [message, ...fields.flatMap((field) => [field.name, field.title, field.about])].join(" ");
  if (SECRET.test(words(asked)) || disguised(asked)) return undefined;
  return { id, harness: "claude", session, project, tool: "elicitation", at: now, kind: "form", server, message, fields, until: now + waited(wait, "form") };
}

function within(field: Field, size: number): boolean {
  return (field.least === undefined || size >= field.least) && (field.most === undefined || size <= field.most);
}

function fits(field: Field, value: unknown): boolean {
  if (field.type === "boolean") return typeof value === "boolean";
  if (field.type === "number") return typeof value === "number" && Number.isFinite(value) && within(field, value);
  if (field.type === "integer") return typeof value === "number" && Number.isInteger(value) && within(field, value);
  if (typeof value !== "string" || value.length > VALUE_MOST || CONTROL.test(value) || !within(field, [...value].length)) return false;
  return field.choices.length === 0 || field.choices.includes(value);
}

/// A form answered: its values sent as the server asked for them, or the request declined. Nothing
/// is said for values that do not fit the form.
export function claudeFormAnswer(ask: Ask, answer: Answer): string | undefined {
  if (answer.decision === "ask") return "";
  if (ask.kind !== "form") return undefined;
  if (answer.decision === "deny") return JSON.stringify({ hookSpecificOutput: { hookEventName: "Elicitation", action: "decline" } });
  const content = answer.content;
  if (!content) return undefined;
  const named = new Set(ask.fields.map((field) => field.name));
  if (Object.keys(content).some((name) => !named.has(name))) return undefined;
  for (const field of ask.fields) {
    const given = Object.hasOwn(content, field.name);
    if (!given && field.required) return undefined;
    if (given && !fits(field, content[field.name])) return undefined;
  }
  return JSON.stringify({ hookSpecificOutput: { hookEventName: "Elicitation", action: "accept", content } });
}
