import type { DiffLine } from "@/island/steps";

export type Question = { question: string; header: string; options: Array<{ label: string; description: string }>; multiSelect: boolean };
/// A form's field. Its bounds are the least and most a number may be, or how few and how many
/// characters words may have.
export type Field = { name: string; title: string; about: string; type: "string" | "number" | "integer" | "boolean"; choices: string[]; required: boolean; least?: number; most?: number };

/// The longest value a form's field can send, and what none may hold: the core refuses either, and
/// the question would go back with what was typed.
const VALUE_MOST = 2_000;
const CONTROL = /\p{Cc}/u;

/// A coding agent waiting on the user, held on the island until it is answered here or handed back
/// to the agent to ask in its own way: a permission, questions to choose among, a plan to approve,
/// an edit to allow, or a form one of its servers asks to have filled in.
export type AgentAsk = {
  id: string;
  harness: string;
  session: string;
  project: string;
  tool: string;
  at: number;
  until: number;
} & (
  | { kind: "permission"; verb: string; target: string }
  | { kind: "choice"; questions: Question[] }
  | { kind: "plan"; plan: string }
  | { kind: "edit"; path: string; fresh: boolean; whole: boolean; every: boolean; diff: DiffLine[]; added: number; removed: number }
  | { kind: "form"; server: string; message: string; fields: Field[] }
);

export type Decision = "allow" | "deny" | "ask";

/// What an answer carries besides its decision: what was picked, the mode an approved plan goes on
/// in, or a form's values.
export type Extra = {
  picked?: Record<string, string[]>;
  mode?: "acceptEdits" | "default";
  content?: Record<string, string | number | boolean>;
};

/// Seconds until the agent stops waiting and asks itself.
export function secondsLeft(ask: AgentAsk, now: number): number {
  return Math.max(0, Math.ceil((ask.until - now) / 1000));
}

/// Sessions waiting on the user for something other than a question already on the island.
export function waitingBesides(sessions: Array<{ id: string; state: string }>, asks: AgentAsk[]): number {
  return sessions.filter((one) => one.state === "waiting" && !asks.some((ask) => ask.session === one.id)).length;
}

/// A question in one line, for the list: what the agent wants, and what it is about.
export function summaryOf(ask: AgentAsk): { wants: string; about: string } {
  if (ask.kind === "permission") return { wants: `wants to ${ask.verb}`, about: ask.target };
  if (ask.kind === "choice") {
    const about = ask.questions.map((one) => one.header || one.question).join(", ");
    return { wants: ask.questions.length === 1 ? "asks you to choose" : `asks you ${ask.questions.length} questions`, about };
  }
  if (ask.kind === "plan") return { wants: "has a plan for you to approve", about: ask.plan.split("\n").find((line) => line.trim() !== "")?.replace(/^#+\s*/, "") ?? "" };
  if (ask.kind === "edit") return { wants: ask.fresh ? "wants to create" : "wants to edit", about: `${ask.path}, +${ask.added} −${ask.removed}` };
  return { wants: `asks for a form from ${ask.server}`, about: ask.message };
}

/// What is picked for one question so far, by its text alone: a question may be named like something
/// every object has.
export function pickedOf(chosen: Record<string, string[]>, question: Question): string[] {
  return (Object.hasOwn(chosen, question.question) ? chosen[question.question] : undefined) ?? [];
}

/// What was picked, as an answer: every question with at least one option, and one alone where
/// only one may be. Nothing while any is left unanswered.
export function pickedFor(questions: Question[], chosen: Record<string, string[]>): Record<string, string[]> | undefined {
  const picked: Array<[string, string[]]> = [];
  for (const one of questions) {
    const labels = pickedOf(chosen, one);
    const offered = labels.filter((label) => one.options.some((option) => option.label === label));
    if (offered.length === 0 || (!one.multiSelect && offered.length > 1)) return undefined;
    picked.push([one.question, offered]);
  }
  return Object.fromEntries(picked);
}

/// The choice after one more option is pressed: added or taken away where several may be picked,
/// in place of the last where one may.
export function chose(chosen: Record<string, string[]>, question: Question, label: string): Record<string, string[]> {
  const was = pickedOf(chosen, question);
  const now = question.multiSelect ? (was.includes(label) ? was.filter((one) => one !== label) : [...was, label]) : [label];
  return { ...chosen, [question.question]: now };
}

function within(field: Field, size: number): boolean {
  return (field.least === undefined || size >= field.least) && (field.most === undefined || size <= field.most);
}

/// A field's bounds in a few words: the least and most a number may be, or how few and how many
/// characters words may have.
export function boundsOf(field: Field): string {
  const unit = field.type === "string" ? " characters" : "";
  if (field.least !== undefined && field.most !== undefined) return `${field.least} to ${field.most}${unit}`;
  if (field.least !== undefined) return `at least ${field.least}${unit}`;
  return field.most !== undefined ? `at most ${field.most}${unit}` : "";
}

/// A form's typed values as the server asked for them: numbers as numbers and yes or no as such,
/// and what was left empty and need not be filled left out. What is missing or does not read as
/// its field asks is said instead.
export function contentFor(fields: Field[], typed: Record<string, string | boolean>): { content: Record<string, string | number | boolean> } | { missing: string[]; wrong: string[] } {
  const content: Array<[string, string | number | boolean]> = [];
  const missing: string[] = [];
  const wrong: string[] = [];
  for (const field of fields) {
    const value = Object.hasOwn(typed, field.name) ? typed[field.name] : undefined;
    if (field.type === "boolean") {
      if (typeof value === "boolean") content.push([field.name, value]);
      else if (field.required) missing.push(field.title);
      continue;
    }
    const written = typeof value === "string" ? value.trim() : "";
    if (written === "") {
      if (field.required) missing.push(field.title);
      continue;
    }
    if (field.type === "string") {
      const fits = written.length <= VALUE_MOST && !CONTROL.test(written) && within(field, [...written].length);
      if (!fits || (field.choices.length > 0 && !field.choices.includes(written))) wrong.push(field.title);
      else content.push([field.name, written]);
      continue;
    }
    const number = Number(written);
    if (!Number.isFinite(number) || (field.type === "integer" && !Number.isInteger(number)) || !within(field, number)) wrong.push(field.title);
    else content.push([field.name, number]);
  }
  return missing.length > 0 || wrong.length > 0 ? { missing, wrong } : { content: Object.fromEntries(content) };
}
