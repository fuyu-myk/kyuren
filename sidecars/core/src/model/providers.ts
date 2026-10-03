import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { JSONValue, LanguageModel } from "ai";
import { secretFor } from "#connect/secrets.ts";
import type { Demand, Route } from "#model/route.ts";

const OLLAMA_URL = process.env.KYUREN_OLLAMA_URL ?? "http://localhost:11434/v1";
const SMALL = process.env.KYUREN_LOCAL_SMALL ?? "qwen3.5:2b";
const LARGE = process.env.KYUREN_LOCAL_LARGE ?? "qwen3.5:9b";
const CLOUD = process.env.KYUREN_CLOUD_MODEL ?? "claude-opus-5-5";

/// Adds fields to the request body that the provider does not know how to carry.
///
/// `providerOptions` is silently dropped for anything the OpenAI-compatible provider has no schema
/// for, so options set that way never reached Ollama at all. Writing them into the body is the
/// only way to be sure they arrive.
function sending(extra: Record<string, JSONValue>): typeof globalThis.fetch {
  return async (input, init) => {
    if (typeof init?.body !== "string") return fetch(input, init);
    const body = JSON.stringify({ ...JSON.parse(init.body), ...extra });
    return fetch(input, { ...init, body });
  };
}

// Usage is asked for, or a stream never says what it read, and the window could not show it.
const ollama = createOpenAICompatible({ name: "ollama", baseURL: OLLAMA_URL, includeUsage: true });

/// Thinking costs a greeting thirteen seconds and produces nothing the user hears. A separate
/// client asks for none of it, because the setting belongs to the request and the provider will
/// not carry it.
const quiet = createOpenAICompatible({
  name: "ollama",
  baseURL: OLLAMA_URL,
  includeUsage: true,
  fetch: sending({ reasoning_effort: "none" }),
});

/// Ollama's own endpoints, which the OpenAI-compatible surface does not cover.
export const OLLAMA_NATIVE = OLLAMA_URL.replace(/\/v1\/?$/, "");

/// How long a loaded model stays resident. Loading one costs about fifteen seconds, which lands
/// between the user finishing their sentence and hearing anything back.
export const KEEP_ALIVE = process.env.KYUREN_KEEP_ALIVE ?? "30m";

/// The large model holds ten gigabytes and, while it does, the audio device cannot start. It is
/// let go two minutes after it answers rather than half an hour, since a hard question is rare
/// and the microphone is not.
export const LARGE_KEEP_ALIVE = process.env.KYUREN_LARGE_KEEP_ALIVE ?? "2m";

export function keepAliveFor(route: Route): string {
  return route === "local-large" ? LARGE_KEEP_ALIVE : KEEP_ALIVE;
}



/// The key lives in the keychain and reaches this process like every other credential, handed
/// over at start and whenever it changes. The environment is honoured too, for a shell that has
/// one, but an application opened from the Dock has no shell and would otherwise never see it.
function cloudKey(): string | undefined {
  return secretFor("anthropic") ?? process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_AUTH_TOKEN;
}

export function cloudConfigured(): boolean {
  return cloudKey() !== undefined;
}

export function nameFor(route: Route): string {
  if (route === "cloud") return CLOUD;
  return route === "local-small" ? SMALL : LARGE;
}

/// What every cloud request carries, wherever it is made. Effort is set rather than left to the
/// model's default, which is a level below the one the routing was measured and the research run
/// at. A request the model declines is retried by the service on the fallback it recommends for
/// that kind of refusal, rather than ending the turn empty.
export function optionsFor(route: Route): { anthropic: { effort: "high"; fallbacks: "default" } } | undefined {
  return route === "cloud" ? { anthropic: { effort: "high", fallbacks: "default" } } : undefined;
}

export function modelFor(route: Route, difficulty: Demand["difficulty"] = "moderate"): LanguageModel {
  if (route === "cloud") {
    return createAnthropic({ apiKey: cloudKey() })(CLOUD);
  }
  return (difficulty === "trivial" ? quiet : ollama)(nameFor(route));
}

async function reachable(url: string, timeoutMs: number): Promise<boolean> {
  const abort = AbortSignal.timeout(timeoutMs);
  try {
    await fetch(url, { signal: abort });
    return true;
  } catch {
    return false;
  }
}

export function localReachable(): Promise<boolean> {
  return reachable(`${OLLAMA_URL}/models`, 1500);
}

/// Reaching the cloud provider is what "online" means here. A machine with a network but no route
/// to Anthropic is offline for the purposes of routing.
export function online(): Promise<boolean> {
  return reachable("https://api.anthropic.com/v1/models", 2500);
}
