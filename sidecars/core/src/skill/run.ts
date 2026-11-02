import { secretFor } from "#connect/secrets.ts";
import { leadsNearby, lookupAll, type Resolve } from "#connect/web/nearby.ts";
import { requestFor, scrub, scrubbed, type Given, type Request } from "#skill/call.ts";
import type { Skill } from "#skill/shape.ts";
import type { Skills } from "#skill/store.ts";

/// How long a skill is given to answer, and how much of its answer is kept.
const PATIENCE = 20_000;
const HELD = 20_000;
/// Read past what is kept, so a key that falls across the cut is whole when it is cleared.
const MARGIN = 4_096;

/// How many times a skill's address may send it on before it is taken as lost.
const HOPS = 5;

/// Asks for a skill's answer, following a redirect only within the address it was approved for:
/// where a redirect would send it elsewhere was never looked at, and could be this machine.
async function fetchWithin(request: Request, signal: AbortSignal): Promise<Response | { refused: string }> {
  const origin = new URL(request.url).origin;
  let { url, method, body } = request;
  for (let hop = 0; ; hop += 1) {
    const answered = await fetch(url, { method, headers: request.headers, body, redirect: "manual", signal });
    const location = answered.headers.get("location");
    if (answered.status < 300 || answered.status > 399 || location === null) return answered;
    const next = new URL(location, url);
    if (next.origin !== origin) return { refused: `sent elsewhere, to ${next.origin}` };
    if (hop === HOPS) return { refused: `sent on more than ${HOPS} times` };
    // As a browser does: only a 307 or a 308 asks again in the same way.
    if (answered.status !== 307 && answered.status !== 308) {
      method = method === "HEAD" ? "HEAD" : "GET";
      body = undefined;
    }
    url = next.href;
  }
}

/// How much of what a service says about a failure is passed on.
const COMPLAINT = 200;

/// What a service said about a failure, in its own words where it gives them, so the trouble can
/// be told apart from another that answers with the same status.
function complaint(text: string): string {
  try {
    const parsed = JSON.parse(text) as { error?: unknown; message?: unknown; error_description?: unknown };
    const error = parsed.error as { message?: unknown } | string | undefined;
    const found = [typeof error === "object" ? error?.message : undefined, parsed.message, parsed.error_description, error]
      .find((one): one is string => typeof one === "string" && one.trim() !== "");
    if (found) return found.trim();
  } catch {
    // Not json, so the start of what was said is the best account there is.
  }
  return text.replace(/\s+/g, " ").trim();
}

/// What a forged skill's credential is called where credentials are kept, both here and in the
/// keychain. Namespaced so a skill cannot name its credential after one Kyuren holds for
/// something else and be handed that instead.
export const FORGED = "skill:";

/// The keychain entry a skill's key is kept in: its credential's name at the host it goes to. A
/// key is kept for one host, so a skill pointed anywhere else that names it finds nothing to send.
export function keyFor(skill: Skill): string | undefined {
  if (skill.auth.mode === "none") return undefined;
  return `${FORGED}${skill.auth.credential}@${new URL(skill.url.replace(/\{[a-zA-Z][a-zA-Z0-9_]*\}/g, "x")).host}`;
}

/// Reads no more of an answer than is kept, so a service that never stops answering is not read
/// for ever.
async function readUpTo(answered: Response, most: number): Promise<string> {
  if (!answered.body) return "";
  const reader = answered.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (text.length < most) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  await reader.cancel().catch(() => undefined);
  return text.slice(0, most);
}

export type Ran =
  | { ok: true; status: number; read: unknown }
  | { ok: false; reason: string; broke: boolean };

/// Runs a skill, after checking with the store that it is one that may be run.
///
/// The standing is read here rather than taken from the caller. That is the whole of gate two:
/// there is no argument, and no sequence of calls, that makes a pending skill run, because
/// nothing that runs one takes its word for what it is.
export async function runSkill(skills: Skills, id: string, given: Given, resolve: Resolve = lookupAll): Promise<Ran> {
  const skill: Skill | undefined = skills.find(id);
  if (!skill) return { ok: false, reason: "there is no such skill", broke: false };
  if (skill.state !== "approved") {
    return {
      ok: false,
      reason: `${skill.name} is ${skill.state} and has not been approved`,
      broke: false,
    };
  }

  const key = keyFor(skill);
  const secret = key === undefined ? undefined : secretFor(key);
  const built = requestFor(skill, given, secret);
  if ("wrong" in built) return { ok: false, reason: built.wrong, broke: false };

  // Where a skill points was checked by name when it was approved; where that name leads now is
  // looked at each time, and somewhere nearby says nothing about whether the skill works.
  if (await leadsNearby(new URL(built.request.url).hostname, resolve)) {
    return { ok: false, reason: `${skill.name} leads to this machine or its network`, broke: false };
  }

  const stop = AbortSignal.timeout(PATIENCE);
  try {
    const answered = await fetchWithin(built.request, stop);
    // Being sent somewhere it was not approved for says nothing about whether the skill works.
    if ("refused" in answered) return { ok: false, reason: `${skill.name} was ${answered.refused}`, broke: false };

    if (!answered.ok) {
      // Cleared whole and then cut, so a cut never leaves the start of a key behind.
      const said = scrub(complaint(scrub(await readUpTo(answered, HELD + MARGIN), secret)), secret).slice(0, COMPLAINT);
      // A key the service will not take is the key's trouble: the skill asks as it was approved
      // to, and approving it again would mend nothing.
      if (skill.auth.mode !== "none" && (answered.status === 401 || answered.status === 403)) {
        return { ok: false, reason: `the key for ${skill.auth.credential} was refused (${answered.status})${said ? `: ${said}` : ""}`, broke: false };
      }
      // Said once and remembered, rather than tried again: an address that has started answering
      // 403 will answer 403 again, and a skill that quietly retries is a skill nobody fixes.
      const reason = `${skill.name} answered ${answered.status}${said ? `: ${said}` : ""}`;
      skills.breaks(skill.id, reason);
      return { ok: false, reason, broke: true };
    }

    // A service may echo what it was asked, key and all; the model is never shown the key.
    const text = await readUpTo(answered, HELD + MARGIN);
    if (skill.reads === "text") return { ok: true, status: answered.status, read: scrub(text, secret).slice(0, HELD) };
    try {
      return { ok: true, status: answered.status, read: scrubbed(JSON.parse(text.slice(0, HELD)), secret) };
    } catch {
      const reason = `${skill.name} was expected to answer with json and did not`;
      skills.breaks(skill.id, reason);
      return { ok: false, reason, broke: true };
    }
  } catch (cause) {
    const said = cause instanceof Error ? cause.message : String(cause);
    const reason = `${skill.name} could not be reached: ${scrub(said, secret)}`;
    skills.breaks(skill.id, reason);
    return { ok: false, reason, broke: true };
  }
}
