/// A playbook as a shortcut on the island: what it is for, whether it may run, and what it asks.
export type Book = {
  name: string;
  when: string;
  approved: boolean;
  inputs: Array<{ name: string; about: string }>;
};

/// Inputs a run finds for itself, from the words typed and the day: everything else must be said.
const DERIVED = new Set(["slug", "week", "date", "today"]);

/// How a shortcut runs from the notch: at once with nothing to ask, after one answer typed, or only
/// from the chat, where more than one answer can be given.
export function runnable(book: Book): "now" | "asks" | "elsewhere" {
  const [first, ...rest] = book.inputs;
  if (!first) return "now";
  return rest.every((one) => DERIVED.has(one.name)) ? "asks" : "elsewhere";
}

/// What the box asks for, in the playbook's own words.
export function promptFor(book: Book): string {
  const first = book.inputs[0];
  return first ? `${first.name}: ${first.about}` : "";
}

/// The shortcuts chosen in settings that are approved playbooks, in the order chosen.
export function chosen(names: string[], books: Book[]): Book[] {
  return names.flatMap((name) => books.filter((one) => one.name === name && one.approved));
}
