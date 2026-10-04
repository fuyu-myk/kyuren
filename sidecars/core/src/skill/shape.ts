import { nearby } from "#connect/web/nearby.ts";

export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type Method = (typeof METHODS)[number];

export const WHERE = ["path", "query", "header", "body"] as const;
export type Where = (typeof WHERE)[number];

export const KINDS = ["string", "number", "boolean"] as const;
export type Kind = (typeof KINDS)[number];

export type Parameter = {
  name: string;
  in: Where;
  kind: Kind;
  required: boolean;
  about: string;
};

/// How a skill proves who it is. The credential is named, never carried: the name says which
/// keychain entry to fetch at the moment of the call, and the value is never written down.
export type Auth =
  | { mode: "none" }
  | { mode: "bearer"; credential: string }
  | { mode: "header"; credential: string; header: string }
  | { mode: "query"; credential: string; query: string };

/// What a skill is allowed to be in.
///
/// Pending is where every skill starts and where every edit returns it: approving a harmless
/// request and then rewriting it into a different one is the obvious way to get past the gate,
/// so approval is of a request rather than of a name.
export type State = "pending" | "approved" | "broken";

export type Skill = {
  id: string;
  name: string;
  about: string;
  method: Method;
  url: string;
  parameters: Parameter[];
  headers: Record<string, string>;
  auth: Auth;
  reads: "json" | "text";
  state: State;
  drafted: number;
  approved?: number;
  /// The approval whose first call the user said yes to.
  confirmed?: number;
  trouble?: string;
};

/// What a skill is before it has an identity or a standing: the part the model writes.
export type Draft = Omit<Skill, "id" | "state" | "drafted" | "approved" | "confirmed" | "trouble">;

/// Approved, and not yet called with the user's yes since. Approving was of what it would do, so
/// its first call is asked about whatever its host was allowed before.
export function untried(skill: Skill): boolean {
  return skill.state === "approved" && skill.approved !== undefined && skill.confirmed !== skill.approved;
}

const NAME = /^[a-z][a-z0-9_]{2,39}$/;
const PARAMETER = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;
const PLACEHOLDER = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;

/// Names that already mean something, which a forged skill may not take over.
const TAKEN = new Set([
  "read_file",
  "list_directory",
  "write_file",
  "add_to_notion",
  "remember",
  "today",
  "project",
  "code",
  "skill",
  "forge",
]);

/// Headers a skill may not set for itself. Authorisation is arranged by the auth mode, from the
/// keychain, at the moment of the call; a header set at draft time would be a credential written
/// into the skill.
const REFUSED = new Set(["authorization", "proxy-authorization", "cookie", "host"]);

/// Where a skill is allowed to point.
///
/// Only the public internet over https. A skill aimed at this machine or at the network it sits
/// on is how a request template becomes a way to read something that was never published.
export function reachable(url: string): string | undefined {
  let where: URL;
  try {
    where = new URL(url.replace(PLACEHOLDER, "x"));
  } catch {
    return "that is not an address";
  }
  if (where.protocol !== "https:") return "a skill may only reach https addresses";
  if (nearby(where.hostname)) return "a skill may not reach this machine or its network";
  if (where.username !== "" || where.password !== "") {
    return "an address may not carry a name and password";
  }
  return undefined;
}

/// Whether every placeholder sits in the part of an address that a parameter is allowed to fill.
///
/// A placeholder in the host is a different skill for every value: approving one that reaches a
/// weather service would approve one that reaches anywhere.
export function onlyInPath(url: string): boolean {
  let origin: string;
  try {
    origin = new URL(url.replace(PLACEHOLDER, "x")).origin;
  } catch {
    return false;
  }

  const before = url.indexOf("{");
  return before === -1 || before >= origin.length;
}

export function placeholders(url: string): string[] {
  return [...url.matchAll(PLACEHOLDER)].map((found) => found[1]!);
}

/// Everything wrong with a draft, said plainly. An empty list means it is well formed, which is
/// not the same as it being safe to run: that is what approval is for.
export function faults(draft: Draft, taken: string[] = []): string[] {
  const wrong: string[] = [];

  if (!NAME.test(draft.name)) {
    wrong.push("a name must be lower case letters, digits and underscores, three to forty of them");
  }
  if (TAKEN.has(draft.name) || taken.includes(draft.name)) {
    wrong.push(`${draft.name} is already the name of something`);
  }
  if (draft.about.trim().length < 12) {
    wrong.push("a skill must say what it does, in a sentence the model can choose it by");
  }
  if (!METHODS.includes(draft.method)) wrong.push(`${draft.method} is not a method a skill may use`);

  const unreachable = reachable(draft.url);
  if (unreachable) wrong.push(unreachable);
  else if (!onlyInPath(draft.url)) {
    wrong.push("a parameter may fill part of the path, never part of the address itself");
  }

  const named = new Set<string>();
  for (const parameter of draft.parameters) {
    if (!PARAMETER.test(parameter.name)) {
      wrong.push(`${parameter.name} is not a name a parameter may have`);
    }
    if (named.has(parameter.name)) wrong.push(`${parameter.name} is given twice`);
    named.add(parameter.name);
    if (!WHERE.includes(parameter.in)) wrong.push(`${parameter.name} has nowhere to go`);
    if (!KINDS.includes(parameter.kind)) wrong.push(`${parameter.name} has no kind`);
    if (parameter.in === "header" && REFUSED.has(parameter.name.toLowerCase())) {
      wrong.push(`${parameter.name} is not a header a skill may set`);
    }
  }

  for (const holder of placeholders(draft.url)) {
    const parameter = draft.parameters.find((one) => one.name === holder);
    if (!parameter) wrong.push(`the address asks for ${holder}, which is not a parameter`);
    else if (parameter.in !== "path") wrong.push(`${holder} is in the address but is not a path parameter`);
  }

  for (const parameter of draft.parameters) {
    if (parameter.in === "path" && !placeholders(draft.url).includes(parameter.name)) {
      wrong.push(`${parameter.name} is a path parameter but the address never uses it`);
    }
  }

  for (const header of Object.keys(draft.headers)) {
    if (REFUSED.has(header.toLowerCase())) wrong.push(`${header} is not a header a skill may set`);
  }

  if (draft.auth.mode !== "none" && draft.auth.credential.trim() === "") {
    wrong.push("a skill that proves who it is must say which credential to use");
  }
  if (draft.reads !== "json" && draft.reads !== "text") wrong.push("a skill reads json or text");

  return wrong;
}
