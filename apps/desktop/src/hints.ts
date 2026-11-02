import type { Parameter } from "@/sessions";

/// A skill as its slash sees it: what it takes, and the values each was given before.
export type Asked = { name: string; parameters: Parameter[]; recent?: Record<string, string[]> };

export type Hint = { label: string; about: string; text: string };

type Given = Record<string, string | number | boolean>;

/// A value given by name, plain or in quotes when it holds spaces.
const PAIR = /(^|\s)([A-Za-z][A-Za-z0-9_]*)=("[^"]*"|\S*)/g;

/// Where words typed without a name go: the first value needed, or the first there is.
function plain(parameters: Parameter[]): Parameter | undefined {
  return parameters.find((one) => one.required) ?? parameters[0];
}

/// A slash's words split into the values named in them, as typed, and the words left over.
function split(parameters: Parameter[], words: string): { named: Map<string, string>; typed: string[]; free: string } {
  const names = new Set(parameters.map((one) => one.name));
  const named = new Map<string, string>();
  const typed: string[] = [];
  const free = words.replace(PAIR, (whole, space: string, name: string, value: string) => {
    if (!names.has(name)) return whole;
    named.set(name, value.replace(/^"|"$/g, ""));
    typed.push(`${name}=${value}`);
    return space;
  });
  return { named, typed, free: free.replace(/\s+/g, " ").trim() };
}

function kindOf(parameter: Parameter, raw: string): string | number | boolean | { wrong: string } {
  if (parameter.kind === "number") {
    const number = Number(raw);
    return raw.trim() !== "" && Number.isFinite(number) ? number : { wrong: `${parameter.name} should be a number` };
  }
  if (parameter.kind === "boolean") {
    if (/^(yes|true|on)$/i.test(raw)) return true;
    if (/^(no|false|off)$/i.test(raw)) return false;
    return { wrong: `${parameter.name} should be yes or no` };
  }
  return raw;
}

/// The values a skill's slash gives it, each of its own kind, or what is wrong with them. Nothing
/// is sent until all of them are right.
export function valuesFor(skill: Asked, words: string): { values: Given } | { wrong: string } {
  const { named, free } = split(skill.parameters, words);
  if (free !== "") {
    const target = plain(skill.parameters);
    if (!target) return { wrong: `${skill.name} takes nothing` };
    if (named.has(target.name)) return { wrong: `${target.name} is given twice` };
    named.set(target.name, free);
  }
  const values: Given = {};
  for (const parameter of skill.parameters) {
    const raw = named.get(parameter.name);
    if (raw === undefined || raw === "") {
      if (parameter.required) return { wrong: `${parameter.name} is needed` };
      continue;
    }
    const value = kindOf(parameter, raw);
    if (typeof value === "object") return value;
    values[parameter.name] = value;
  }
  return { values };
}

function quoted(value: string): string {
  return /\s/.test(value) ? `"${value}"` : value;
}

function told(parameter: Parameter): string {
  const kind = `${parameter.kind}${parameter.required ? ", needed" : ""}`;
  return parameter.about ? `${kind}: ${parameter.about}` : kind;
}

/// What to offer while a skill's values are typed: the values given before, newest first, then
/// the names it takes that are not given yet. Picking one leaves the whole line it makes.
export function hintsFor(skill: Asked, line: string): Hint[] {
  const head = `/${skill.name}`;
  if (!line.startsWith(`${head} `)) return [];
  const words = line.slice(head.length);
  const fragment = words.slice(words.lastIndexOf(" ") + 1);
  const before = line.slice(0, line.length - fragment.length);
  const recent = skill.recent ?? {};

  const naming = /^([A-Za-z][A-Za-z0-9_]*)=(.*)$/.exec(fragment);
  const being = naming ? skill.parameters.find((one) => one.name === naming[1]) : undefined;
  if (naming && being) {
    const partial = (naming[2] ?? "").replace(/^"/, "").toLowerCase();
    return (recent[being.name] ?? [])
      .filter((value) => value.toLowerCase().startsWith(partial) && value.toLowerCase() !== partial)
      .map((value) => ({ label: value, about: `${being.name}, used before`, text: `${before}${being.name}=${quoted(value)} ` }));
  }

  const { named, typed, free } = split(skill.parameters, words);
  const target = plain(skill.parameters);
  const hints: Hint[] = [];
  if (target && !named.has(target.name)) {
    const typedSoFar = free.toLowerCase();
    for (const value of recent[target.name] ?? []) {
      if (!value.toLowerCase().startsWith(typedSoFar) || value.toLowerCase() === typedSoFar) continue;
      hints.push({ label: value, about: `${target.name}, used before`, text: `${[head, value, ...typed].join(" ")} ` });
    }
  }
  if (!fragment.includes("=")) {
    for (const parameter of skill.parameters) {
      if (parameter === target || named.has(parameter.name) || !parameter.name.startsWith(fragment)) continue;
      hints.push({ label: `${parameter.name}=`, about: told(parameter), text: `${before}${parameter.name}=` });
    }
  }
  return hints.slice(0, 8);
}
