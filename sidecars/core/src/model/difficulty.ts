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

/// For a question asked aloud, where waiting is felt most: what the model knows is split from what
/// needs a look, which still reasons, since only a model that reasons reaches for a tool.
const SPOKEN = `You are a router for questions asked out loud. Reply with exactly one of these four words and nothing else: trivial, known, look, hard.

trivial = a greeting, thanks, goodbye, or small talk.
known = a fact, a definition or an explanation anyone could give from general knowledge, or today's date, with nothing about the user to look up.
look = anything about the user, their people, day, calendar, tasks, mail, notes or projects, anything needing the web or the news, or anything to be done for them.
hard = needs working out step by step: maths, converting a time between places, planning, or weighing options.

Examples:
hello -> trivial
thanks, that is all -> trivial
what is photosynthesis -> known
who wrote pride and prejudice -> known
explain how a rainbow forms -> known
how do I boil an egg -> known
tell me a joke -> known
what day is it -> known
what is on today -> look
when is my next class -> look
what is my sister's name -> look
do I have any unread mail -> look
what is the weather tomorrow -> look
who won the match last night -> look
remind me to call mum at five -> look
what time is it in tokyo -> hard
plan my week around these deadlines -> hard

Request: `;

/// Asked once the judge has called a question known, since the small model takes a question about
/// the user's life or about the present for general knowledge half the time. Put as what a printed
/// encyclopedia could answer, it rarely does. See MEASUREMENTS.
const ENCYCLOPEDIA = `Could an encyclopedia printed last year answer this question fully, with nothing about the person asking and nothing that happened since? Reply with exactly one word, yes or no.

Examples:
what is photosynthesis -> yes
who wrote pride and prejudice -> yes
explain how a rainbow forms -> yes
tell me a joke -> yes
what is my sister's name -> no
what did my tutor say about the draft -> no
who won the match yesterday -> no
is the pharmacy open -> no
how much is gold worth -> no

Question: `;

/// What no model knows without a look: the user's own things, and what is happening now. Taken as
/// known it would be answered from nothing, so the judge is overruled where these words appear.
const LOOKED_UP = /\b(my|mine|myself|today|tonight|tomorrow|yesterday|news|latest|weather)\b/i;

function readWord(said: string): Difficulty | undefined {
  const word = said.trim().toLowerCase().replace(/[^a-z]/g, "");
  return word === "trivial" || word === "moderate" || word === "hard" ? word : undefined;
}

async function judged(asking: string, prompt: string): Promise<string> {
  const decided = await generateText({
    model: modelFor("local-small", "trivial"),
    prompt: asking + prompt,
    maxOutputTokens: 6,
    temperature: 0,
    abortSignal: AbortSignal.timeout(10_000),
  });
  return decided.text;
}

/// Judging the request costs a fifth of a second on the model that is already resident. Guessing
/// wrong low costs a worse answer; guessing wrong high costs the user ten seconds of waiting, so
/// an unreadable answer settles on the middle rather than the top.
export async function difficultyOf(prompt: string): Promise<Difficulty> {
  try {
    return readWord(await judged(ASK, prompt)) ?? "moderate";
  } catch {
    return "moderate";
  }
}

/// The spoken judge's word as a tier. One it cannot read settles on needing a look, which reasons:
/// slower than it might have been beats answering a question about the day from nothing.
export function readSpoken(said: string, asked: string): Difficulty {
  const word = said.trim().toLowerCase().replace(/[^a-z]/g, "");
  if (word === "known") return LOOKED_UP.test(asked) ? "moderate" : "known";
  if (word === "trivial" || word === "hard") return word;
  return "moderate";
}

export async function spokenDifficultyOf(prompt: string): Promise<Difficulty> {
  try {
    const tier = readSpoken(await judged(SPOKEN, prompt), prompt);
    if (tier !== "known") return tier;
    const printed = (await judged(ENCYCLOPEDIA, prompt)).trim().toLowerCase().replace(/[^a-z]/g, "");
    return printed === "yes" ? "known" : "moderate";
  } catch {
    return "moderate";
  }
}
