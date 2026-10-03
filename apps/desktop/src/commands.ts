export type Command = {
  name: string;
  about: string;
  kind: "playbook" | "capability";
};

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
