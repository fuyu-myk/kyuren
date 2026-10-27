import { z } from "zod";
import { waited, type Answer, type Ask, type Question, type Wait } from "#coding/asked.ts";
import { HIDING, projectOf, requestOf } from "#coding/shown.ts";

/// The longest answer typed in place of a question's options, and what it may not hold.
const OTHER_MOST = 1_000;
const CONTROL = /\p{Cc}/u;

/// Questions as the island shows them, and nothing beside: one carrying more, a preview drawn beside
/// an option or anything Claude Code adds later, is for its own picker.
const QUESTIONS = z
  .array(
    z.strictObject({
      question: z.string().min(1).max(400),
      header: z.string().max(60).optional(),
      options: z.array(z.strictObject({ label: z.string().min(1).max(120), description: z.string().max(400).optional() })).min(2).max(4),
      multiSelect: z.boolean().optional(),
    }),
  )
  .min(1)
  .max(4);

/// Questions Claude Code is about to ask the user to choose among, as the island shows them: all of
/// them whole, or none, so that Claude Code asks them itself.
export function claudeChoice(payload: unknown, id: string, now: number, wait: Wait): Ask | undefined {
  const request = requestOf(payload);
  if (!request || request.tool_name !== "AskUserQuestion") return undefined;
  const project = projectOf(request.cwd);
  const parsed = QUESTIONS.safeParse(request.tool_input.questions);
  if (project === undefined || !parsed.success) return undefined;
  const questions: Question[] = parsed.data.map((one) => ({
    question: one.question,
    header: one.header ?? "",
    options: one.options.map((option) => ({ label: option.label, description: option.description ?? "" })),
    multiSelect: one.multiSelect === true,
  }));
  const words = questions.flatMap((one) => [one.question, one.header, ...one.options.flatMap((option) => [option.label, option.description])]);
  if (words.some((word) => HIDING.test(word))) return undefined;
  // Each answer is given by its question's text and the labels picked, so neither may repeat.
  if (new Set(questions.map((one) => one.question)).size !== questions.length) return undefined;
  if (questions.some((one) => new Set(one.options.map((option) => option.label)).size !== one.options.length)) return undefined;
  return {
    id,
    harness: "claude",
    session: request.session_id,
    project,
    tool: request.tool_name,
    at: now,
    kind: "choice",
    questions,
    until: now + waited(wait, "choice"),
  };
}

/// What was picked, as Claude Code takes an answer: its questions as they were asked, and each
/// question's text given the labels picked for it, joined by commas where more than one may be.
/// Nothing is said for a pick that does not fit what was asked.
export function claudeChoiceAnswer(payload: unknown, ask: Ask, answer: Answer): string | undefined {
  if (answer.decision === "ask") return "";
  const request = requestOf(payload);
  if (answer.decision !== "allow" || ask.kind !== "choice" || !request) return undefined;
  const picked = answer.picked ?? {};
  const other = answer.other ?? {};
  const asked = new Set(ask.questions.map((one) => one.question));
  if ([...Object.keys(picked), ...Object.keys(other)].some((key) => !asked.has(key))) return undefined;
  const answers: Array<[string, string]> = [];
  for (const one of ask.questions) {
    const labels = (Object.hasOwn(picked, one.question) ? picked[one.question] : undefined) ?? [];
    if (!Array.isArray(labels) || new Set(labels).size !== labels.length || labels.some((label) => !one.options.some((option) => option.label === label))) return undefined;
    const typed = Object.hasOwn(other, one.question) ? other[one.question] : undefined;
    const text = typeof typed === "string" ? typed.trim() : undefined;
    if (typed !== undefined && (!text || text.length > OTHER_MOST || CONTROL.test(text))) return undefined;
    const given = text ? [...labels, text] : labels;
    if (given.length === 0 || (!one.multiSelect && given.length > 1)) return undefined;
    answers.push([one.question, given.join(", ")]);
  }
  const updatedInput = { ...request.tool_input, answers: Object.fromEntries(answers) };
  return JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput } });
}
