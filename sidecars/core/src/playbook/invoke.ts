import { readFileSync } from "node:fs";
import { filled } from "#playbook/proof.ts";
import type { Playbook } from "#playbook/shape.ts";

/// A short file name from a sentence: lowercase words joined with dashes, a few words at most.
export function slugOf(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .filter(Boolean)
    .slice(0, 6)
    .join("-")
    .slice(0, 48) || "note";
}

/// The ISO week a day falls in, as 2026-W38.
export function isoWeek(day: Date): string {
  const date = new Date(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()));
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/// What a slash command gives a playbook. The words after the command are its first input; any
/// other input is derived when its name says how, and asked for by name when it cannot be.
export function inputsFrom(book: Playbook, text: string, now = new Date()): Record<string, string> {
  const inputs: Record<string, string> = {};
  const [first, ...rest] = book.inputs;
  if (first) {
    if (text.trim() === "") throw new Error(`/${book.name} needs ${first.name}: ${first.about}`);
    inputs[first.name] = text.trim();
  }
  const missing: string[] = [];
  for (const one of rest) {
    if (one.name === "slug") inputs.slug = slugOf(text);
    else if (one.name === "week") inputs.week = isoWeek(now);
    else if (one.name === "date" || one.name === "today") inputs[one.name] = now.toISOString().slice(0, 10);
    else missing.push(`${one.name}: ${one.about}`);
  }
  if (missing.length > 0) throw new Error(`/${book.name} also needs ${missing.join("; ")}`);
  return inputs;
}

function derived(name: string, words: string, now: Date): string | undefined {
  if (name === "slug") return words.trim() === "" ? undefined : slugOf(words);
  if (name === "week") return isoWeek(now);
  if (name === "date" || name === "today") return now.toISOString().slice(0, 10);
  return undefined;
}

/// Inputs given by name, for a run nobody typed, with the rest derived the way a command's are:
/// a slug from the first input, the week, the date. What is neither given nor derivable is
/// missing, and it says which.
export function inputsFor(book: Playbook, given: Record<string, string>, now = new Date()): Record<string, string> {
  const [first] = book.inputs;
  const words = first ? given[first.name] ?? "" : "";
  const inputs: Record<string, string> = {};
  const missing: string[] = [];
  for (const one of book.inputs) {
    const value = given[one.name] ?? derived(one.name, words, now);
    if (value === undefined || value.trim() === "") missing.push(`${one.name}: ${one.about}`);
    else inputs[one.name] = value;
  }
  if (missing.length > 0) throw new Error(`${book.name} needs ${missing.join("; ")}`);
  return inputs;
}

/// The file a playbook's proof is about, read back after a run so the answer can be shown rather
/// than pointed at. The first proof item that names a file decides which.
export function producedBy(book: Playbook, inputs: Record<string, string>, home: string): { path: string; text: string } | undefined {
  for (const item of book.proof) {
    if (item.kind === "judged" || item.kind === "exit") continue;
    const path = filled(item.path, { inputs, home });
    try {
      return { path, text: readFileSync(path, "utf8").slice(0, 20_000) };
    } catch {
      continue;
    }
  }
  return undefined;
}
