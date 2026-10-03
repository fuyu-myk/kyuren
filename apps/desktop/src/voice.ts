import { invoke } from "@tauri-apps/api/core";

export function speak(text: string): Promise<void> {
  return invoke("speak", { text });
}
