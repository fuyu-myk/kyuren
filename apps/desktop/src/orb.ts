import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Voice } from "@/island/channels";

export function onOrbState(handler: (state: Voice) => void): Promise<UnlistenFn> {
  return listen<Voice>("orb:state", (event) => handler(event.payload));
}
