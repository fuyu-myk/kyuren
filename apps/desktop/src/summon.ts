import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// Every summons of the island, by the hotkey or by name. A dismissal is not one.
export function onSummoned(handler: () => void): Promise<UnlistenFn> {
  return listen("island:summon", handler);
}
