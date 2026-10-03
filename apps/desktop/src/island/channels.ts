import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";

export type Notch = { present: boolean; width: number; height: number };

export type Voice = "idle" | "listening" | "thinking" | "speaking";

export function insideTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

/// Outside the app, in a browser, events come from the preview's own controls instead.
const preview = new EventTarget();

export function emitPreview(name: string, payload?: unknown): void {
  preview.dispatchEvent(new CustomEvent(name, { detail: payload }));
}

export async function on<T>(name: string, handler: (payload: T) => void): Promise<UnlistenFn> {
  if (insideTauri()) return listen<T>(name, (event) => handler(event.payload));
  const listener = (event: globalThis.Event) => handler((event as CustomEvent<T>).detail);
  preview.addEventListener(name, listener);
  return () => preview.removeEventListener(name, listener);
}

/// A host command, or nothing outside the app.
export async function command<T>(name: string, args?: Record<string, unknown>): Promise<T | undefined> {
  if (!insideTauri()) return undefined;
  return invoke<T>(name, args);
}

/// Files carried over the island from another app, as the webview's own drag and drop reports them.
export type Carried = { type: "enter"; paths: string[] } | { type: "over" } | { type: "drop"; paths: string[] } | { type: "leave" };

export async function onCarried(handler: (carried: Carried) => void): Promise<UnlistenFn> {
  if (insideTauri()) return getCurrentWebview().onDragDropEvent((event) => handler(event.payload));
  return on<Carried>("preview:carried", handler);
}
