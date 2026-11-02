import { placeholders, type Skill } from "#skill/shape.ts";

export type Given = Record<string, string | number | boolean>;

export type Request = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
};

export type Built = { request: Request } | { wrong: string };

function kindOf(value: unknown): string {
  return typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "string";
}

/// Builds the one request a skill makes.
///
/// The secret is passed in at the moment of the call and used here; it is never kept, never
/// returned, and never part of anything the model is shown.
export function requestFor(skill: Skill, given: Given, secret?: string): Built {
  const url = new URL(skill.url.replace(/\{[a-zA-Z][a-zA-Z0-9_]*\}/g, "x"));
  const origin = url.origin;

  // Only what was given counts: a parameter named after something every object has is not given
  // by being asked after.
  const of = (name: string) => (Object.hasOwn(given, name) ? given[name] : undefined);

  for (const parameter of skill.parameters) {
    const value = of(parameter.name);
    if (value === undefined || value === "") {
      if (parameter.required) return { wrong: `${parameter.name} is needed and was not given` };
      continue;
    }
    if (kindOf(value) !== parameter.kind) {
      return { wrong: `${parameter.name} should be a ${parameter.kind}` };
    }
  }

  let filled = skill.url;
  for (const holder of placeholders(skill.url)) {
    const value = of(holder);
    if (value === undefined) return { wrong: `${holder} is needed and was not given` };
    // A step up or a step in place is still one segment, but it moves the request off the shape
    // that was approved.
    if (String(value) === "." || String(value) === "..") return { wrong: `${holder} cannot be . or ..` };
    // Encoded, so a value can only ever be one segment of the path.
    filled = filled.replace(`{${holder}}`, encodeURIComponent(String(value)));
  }

  let where: URL;
  try {
    where = new URL(filled);
  } catch {
    return { wrong: "the values given do not make an address" };
  }
  // Checked again after filling in, because what was approved was a request to one place.
  if (where.origin !== origin) return { wrong: "the values given would send this somewhere else" };

  const headers: Record<string, string> = { ...skill.headers };
  const body: Record<string, string | number | boolean> = {};

  for (const parameter of skill.parameters) {
    const value = of(parameter.name);
    if (value === undefined || value === "") continue;
    if (parameter.in === "query") where.searchParams.set(parameter.name, String(value));
    if (parameter.in === "header") headers[parameter.name] = String(value);
    if (parameter.in === "body") body[parameter.name] = value;
  }

  if (skill.auth.mode !== "none") {
    if (secret === undefined || secret === "") {
      return { wrong: `the key for ${skill.auth.credential} at ${where.host} is not held` };
    }
    if (skill.auth.mode === "bearer") headers.authorization = `Bearer ${secret}`;
    if (skill.auth.mode === "header") headers[skill.auth.header] = secret;
    if (skill.auth.mode === "query") where.searchParams.set(skill.auth.query, secret);
  }

  const sends = skill.method !== "GET" && skill.method !== "DELETE";
  if (sends && Object.keys(body).length > 0) headers["content-type"] = "application/json";

  return {
    request: {
      url: where.toString(),
      method: skill.method,
      headers,
      body: sends && Object.keys(body).length > 0 ? JSON.stringify(body) : undefined,
    },
  };
}

/// Every way a key can come back in what a service says: as it is, escaped as this request escaped
/// it or as an address or a form would, twice over as a link inside a link, escaped inside a string
/// of json, or in base64.
function formsOf(secret: string): string[] {
  const encoded = encodeURIComponent(secret);
  const asSent = new URLSearchParams({ k: secret }).toString().slice(2);
  return [...new Set([
    secret,
    encoded,
    encoded.replace(/%20/g, "+"),
    asSent,
    asSent.replace(/\+/g, "%20"),
    encodeURIComponent(encoded),
    encodeURIComponent(asSent),
    JSON.stringify(secret).slice(1, -1),
    Buffer.from(secret).toString("base64"),
    Buffer.from(secret).toString("base64").replace(/=+$/, ""),
  ])].sort((one, other) => other.length - one.length);
}

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/// What a text holds once undone as an address undoes it, a few times over.
function undone(text: string): string[] {
  const seen = [text];
  let at = text;
  for (let round = 0; round < 3; round += 1) {
    try {
      at = decodeURIComponent(at.replace(/\+/g, " "));
    } catch {
      break;
    }
    seen.push(at);
  }
  return seen;
}

/// What a service said, with nothing of the credential in it, whichever way it came back. Escapes
/// differ in case alike, so each form is matched whatever its case; and a text that still holds the
/// key once undone is held back whole, since where in it the key lies cannot then be told.
export function scrub(text: string, secret?: string): string {
  if (!secret || secret.length < 4) return text;
  let said = text;
  for (const form of formsOf(secret)) said = said.replace(new RegExp(escaped(form), "gi"), "[credential]");
  return undone(said).some((one) => one.includes(secret)) ? "[held back, as it held the credential]" : said;
}

/// An answer read as json, with the credential cleared from every string and every name in it,
/// after it is read, so no escape json allows can carry the key past the clearing.
export function scrubbed(value: unknown, secret?: string): unknown {
  if (typeof value === "string") return scrub(value, secret);
  if (Array.isArray(value)) return value.map((one) => scrubbed(one, secret));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([name, inner]) => [scrub(name, secret), scrubbed(inner, secret)]));
  }
  return value;
}
