import { generateText } from "ai";
import { modelFor } from "#model/providers.ts";
import type { Demand } from "#model/route.ts";

export type Difficulty = Demand["difficulty"];

/// Examples rather than definitions. Asked to apply three abstract categories the small model
/// invented a fourth and called a schedule "planning"; shown what each one looks like it agrees
/// nine times in ten, in a fifth of a second.
///
/// Trivial is only what needs nothing looked up. Anything about the user's own day belongs above
/// it: the model has to reach for a tool to answer that, and a model told not to think does not
/// reach for tools at all.
const ASK = `You are a router. Reply with exactly one of these three words and nothing else: trivial, moderate, hard.

trivial = a greeting, thanks, goodbye, or small talk that needs nothing looked up.
moderate = anything needing a fact, a look at the user's calendar, tasks or mail, or a few sentences of explanation.
hard = needs working out step by step: code, maths, planning a schedule, or weighing options.

Examples:
hello -> trivial
thanks, that is all -> trivial
how are you -> trivial
what is on today -> moderate
when is my next class -> moderate
what is photosynthesis -> moderate
explain the difference between two ideas -> moderate
plan my week around these deadlines -> hard
write a function and explain its complexity -> hard
should I drop this course given my other commitments -> hard

Request: `;

function readWord(said: string): Difficulty | undefined {
  const word = said.trim().toLowerCase().replace(/[^a-z]/g, "");
  return word === "trivial" || word === "moderate" || word === "hard" ? word : undefined;
}

/// Judging the request costs a fifth of a second on the model that is already resident. Guessing
/// wrong low costs a worse answer; guessing wrong high costs the user ten seconds of waiting, so
/// an unreadable answer settles on the middle rather than the top.
export async function difficultyOf(prompt: string): Promise<Difficulty> {
  try {
    const decided = await generateText({
      model: modelFor("local-small", "trivial"),
      prompt: ASK + prompt,
      maxOutputTokens: 6,
      temperature: 0,
      abortSignal: AbortSignal.timeout(10_000),
    });
    return readWord(decided.text) ?? "moderate";
  } catch {
    return "moderate";
  }
}
