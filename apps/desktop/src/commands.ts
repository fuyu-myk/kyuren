import { hintsFor } from "./hints.ts";
import type { Parameter } from "@/sessions";

export type Command = {
  name: string;
  about: string;
  kind: "playbook" | "capability" | "skill";
  /// What a skill takes, and the values each was given before, offered as its values are typed.
  parameters?: Parameter[];
  recent?: Record<string, string[]>;
};

/// One line of the menu, and the whole line it leaves in the bar once picked. A command is picked
/// by enter; a hint only by tab, so enter still sends what is typed.
export type Offer = { key: string; label: string; about: string; text: string; hint: boolean };

/// What is being typed as a command: the word after the slash, and whether the word is still
/// being typed, which is when the menu is wanted.
export function typing(text: string): { name: string; open: boolean } | undefined {
  if (!text.startsWith("/")) return undefined;
  const rest = text.slice(1);
  const word = /^[\p{L}\p{N}_-]*/u.exec(rest)?.[0] ?? "";
  return { name: word, open: rest.length === word.length };
}

/// The commands that fit what is being typed, in order, or none when nothing is being typed.
export function suggest(commands: Command[], text: string): Command[] {
  const at = typing(text);
  if (!at || !at.open) return [];
  const wanted = at.name.toLowerCase();
  return commands
    .filter((one) => one.name.toLowerCase().startsWith(wanted))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/// A whole line as a command: its name and the words after it, or nothing if it is not one.
export function parseCommand(text: string): { name: string; text: string } | undefined {
  const match = /^\/([\p{L}\p{N}_-]+)\s*([\s\S]*)$/u.exec(text.trim());
  if (!match) return undefined;
  return { name: match[1] ?? "", text: (match[2] ?? "").trim() };
}

/// Where the highlight goes after an arrow key, wrapping at either end.
export function stepped(index: number, delta: number, count: number): number {
  if (count === 0) return 0;
  return (((index + delta) % count) + count) % count;
}

/// What the menu offers for what is typed: the commands while a name is being typed, then the
/// values a skill takes once its name is.
export function offers(commands: Command[], text: string): Offer[] {
  const named = suggest(commands, text);
  if (named.length > 0) {
    return named.map((one) => ({ key: `${one.kind}-${one.name}`, label: `/${one.name}`, about: one.about, text: `/${one.name} `, hint: false }));
  }
  const at = typing(text);
  const skill = at ? commands.find((one) => one.kind === "skill" && one.name === at.name) : undefined;
  if (!skill?.parameters) return [];
  return hintsFor({ name: skill.name, parameters: skill.parameters, recent: skill.recent }, text)
    .map((one) => ({ key: `hint-${one.text}`, label: one.label, about: one.about, text: one.text, hint: true }));
}
