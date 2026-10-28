import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { insideTauri } from "@/tauri";

/// Credentials go straight to the system keychain through the core process. They are never held in
/// component state beyond the keystroke that enters them, and reading them back is not offered.
export function storeSecret(name: string, secret: string): Promise<string[]> {
  return invoke<string[]>("store_secret", { name, secret });
}

export function forgetSecret(name: string): Promise<string[]> {
  return invoke<string[]>("forget_secret", { name });
}

export function heldSecrets(): Promise<string[]> {
  return invoke<string[]>("held_secrets");
}

/// Starts a service's consent in the browser. The grant returns to a loopback listener in the core
/// process, so nothing is typed back into Kyuren and the code never leaves the machine.
export function connectService(
  service: string,
  clientId: string,
  clientSecret?: string,
): Promise<void> {
  return invoke("connect_service", { service, clientId, clientSecret });
}

export function onConnections(handler: (names: string[]) => void): Promise<UnlistenFn> {
  return listen<string[]>("connections", (event) => handler(event.payload));
}

export type Brief = {
  facts: string;
  read: string[];
  refused: string[];
  unavailable: string[];
  failed: Array<{ source: string; reason: string }>;
};

export function morningBrief(): Promise<Brief> {
  return invoke<Brief>("morning_brief");
}

/// Whether Notion is connected, the databases shared with Kyuren's integration, and which one the
/// island's todos are kept in.
export type NotionTodos = { connected: boolean; databases: Array<{ id: string; title: string }>; chosen?: string };

/// Outside the app, in a browser, a workspace to choose from instead, so the choice can be tried.
const pretendNotion: NotionTodos = { connected: true, databases: [{ id: "tasks", title: "Tasks" }, { id: "reading", title: "Reading list" }] };

export function notionTodos(): Promise<NotionTodos> {
  return insideTauri() ? invoke<NotionTodos>("notion_todos") : Promise.resolve({ ...pretendNotion });
}

export function chooseNotionTodos(id: string | null): Promise<NotionTodos> {
  if (insideTauri()) return invoke<NotionTodos>("notion_todos_choose", { id });
  pretendNotion.chosen = id ?? undefined;
  return Promise.resolve({ ...pretendNotion });
}

/// How the day's work went, as written into the day's note.
export type Recap = { facts: string; note?: string };

export function eveningRecap(): Promise<Recap> {
  return invoke<Recap>("evening_recap");
}

/// Shows the mind over everything, or hides it if it is already there.
export function showMind(): Promise<void> {
  return invoke("show_mind");
}
