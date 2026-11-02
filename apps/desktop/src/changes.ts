import type { Skill } from "@/sessions";

type Shown = Pick<Skill, "about" | "method" | "url" | "parameters" | "headers" | "auth" | "reads">;

/// Each part of a skill as a person reads it, so a change is seen as what it does differently.
const PARTS: Array<{ what: string; said: (skill: Shown) => string }> = [
  { what: "about", said: (skill) => skill.about },
  { what: "request", said: (skill) => `${skill.method} ${skill.url}` },
  {
    what: "takes",
    said: (skill) => skill.parameters.map((one) => `${one.name} (${one.kind} in ${one.in}${one.required ? ", needed" : ""})`).join(", ") || "nothing",
  },
  { what: "headers", said: (skill) => Object.entries(skill.headers).map(([name, value]) => `${name}: ${value}`).join(", ") || "none" },
  { what: "key", said: (skill) => (skill.auth.mode === "none" ? "none" : `${skill.auth.mode}, from the keychain as ${skill.auth.credential ?? ""}`) },
  { what: "reads", said: (skill) => skill.reads },
];

/// What a change to an approved skill would change, part by part: approving it again is agreeing
/// to the difference, so the difference is what is shown.
export function changesOf(skill: Skill): Array<{ what: string; was: string; now: string }> {
  const before = skill.before;
  if (!before) return [];
  return PARTS.map(({ what, said }) => ({ what, was: said(before), now: said(skill) })).filter((one) => one.was !== one.now);
}

/// What the model is asked when a skill is to be made better, or mended once it has broken.
export function improving(skill: Skill): string {
  if (skill.state === "broken") {
    return `Mend the skill ${skill.name}, which broke: ${skill.trouble ?? "it stopped working"}. It cannot be tried `
      + "again until it is approved, so read its documentation and change it with skill_edit, saying why.";
  }
  return `Improve the skill ${skill.name}. Test it with skill_test using sensible values. If it fails, or falls `
    + "short of what its documentation offers, read the documentation and change it with skill_edit, saying "
    + "why. If it works and needs nothing, say so.";
}
