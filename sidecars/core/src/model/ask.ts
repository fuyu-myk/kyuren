import { generateText } from "ai";
import { difficultyOf } from "#model/difficulty.ts";
import { cloudConfigured, modelFor, nameFor, online, optionsFor } from "#model/providers.ts";
import { route, type Demand } from "#model/route.ts";

export type Question = {
  prompt: string;
  system?: string;
  sensitive?: boolean;
  difficulty?: Demand["difficulty"];
};

export type Answer = {
  text: string;
  route: string;
  model: string;
  reason: string;
  elapsedMs: number;
};

export async function ask(question: Question): Promise<Answer> {
  const difficulty = question.difficulty ?? (await difficultyOf(question.prompt));

  const decision = route({
    sensitive: question.sensitive ?? false,
    online: await online(),
    cloudConfigured: cloudConfigured(),
    difficulty,
  });

  const began = performance.now();
  const result = await generateText({
    model: modelFor(decision.route, difficulty),
    system: question.system,
    prompt: question.prompt,
    providerOptions: optionsFor(decision.route),
  });

  return {
    text: result.text.trim(),
    route: decision.route,
    model: nameFor(decision.route),
    reason: decision.reason,
    elapsedMs: Math.round(performance.now() - began),
  };
}
