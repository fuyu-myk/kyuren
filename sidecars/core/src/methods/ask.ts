import { ask, type Question } from "#model/ask.ts";

export async function askMethod(params: Record<string, unknown>) {
  const prompt = params.prompt;
  if (typeof prompt !== "string" || prompt.trim() === "") {
    throw new Error("ask needs a prompt");
  }

  const question: Question = { prompt };
  if (typeof params.system === "string") question.system = params.system;
  if (typeof params.sensitive === "boolean") question.sensitive = params.sensitive;
  if (params.difficulty === "trivial" || params.difficulty === "moderate" || params.difficulty === "hard") {
    question.difficulty = params.difficulty;
  }

  return ask(question);
}
