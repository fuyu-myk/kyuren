import { keepAliveFor, nameFor, OLLAMA_NATIVE } from "#model/providers.ts";
import type { Route } from "#model/route.ts";

/// Loads a local model and holds it in memory. Nothing is generated: an empty prompt is how Ollama
/// is asked to make a model resident without answering anything.
export async function preload(route: Route): Promise<boolean> {
  if (route === "cloud") return false;

  try {
    const response = await fetch(`${OLLAMA_NATIVE}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: nameFor(route), keep_alive: keepAliveFor(route), prompt: "" }),
      signal: AbortSignal.timeout(120_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}


/// Tells Ollama how long to keep a model now that its answer is given. The same empty request as
/// loading, with the route's own patience: for the large model that is minutes, not half an hour.
export async function release(route: Route): Promise<void> {
  if (route === "cloud") return;
  try {
    await fetch(`${OLLAMA_NATIVE}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: nameFor(route), keep_alive: keepAliveFor(route), prompt: "" }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // Left resident, then; Ollama's own timer still applies.
  }
}
