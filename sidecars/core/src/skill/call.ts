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

  for (const parameter of skill.parameters) {
    const value = given[parameter.name];
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
    const value = given[holder];
    if (value === undefined) return { wrong: `${holder} is needed and was not given` };
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
    const value = given[parameter.name];
    if (value === undefined || value === "") continue;
    if (parameter.in === "query") where.searchParams.set(parameter.name, String(value));
    if (parameter.in === "header") headers[parameter.name] = String(value);
    if (parameter.in === "body") body[parameter.name] = value;
  }

  if (skill.auth.mode !== "none") {
    if (secret === undefined || secret === "") {
      return { wrong: `the credential ${skill.auth.credential} is not held` };
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

/// What is said about a call that did not work, with nothing of the credential in it.
export function scrub(text: string, secret?: string): string {
  if (!secret || secret.length < 4) return text;
  return text.split(secret).join("[credential]");
}
