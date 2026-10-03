import { invoke } from "@tauri-apps/api/core";

export type Found = { title: string; url: string; snippet: string };

export type Engine = { set: string | null; live: string; fallbackSet: string | null; fallbackLive: string };

export type Searched = { url: string; results: Found[]; from: string; tried: Array<{ engine: string; reason: string }> };

export function webEngine(): Promise<Engine> {
  return invoke<Engine>("web_engine");
}

export function setWebEngine(engine: string): Promise<unknown> {
  return invoke("web_engine_set", { engine });
}

export function setWebFallback(engine: string): Promise<unknown> {
  return invoke("web_fallback_set", { engine });
}

export function trySearch(query: string): Promise<Searched> {
  return invoke("web_search_try", { query });
}
