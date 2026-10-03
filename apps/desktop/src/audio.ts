import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export function onLevel(handler: (level: number) => void): Promise<UnlistenFn> {
  return listen<number>("orb:energy", (event) => handler(event.payload));
}

export function onSpeech(handler: (speaking: boolean) => void): Promise<UnlistenFn> {
  return listen<boolean>("speech", (event) => handler(event.payload));
}

export type Transcript = {
  text: string;
  final: boolean;
};

export function onTranscript(handler: (transcript: Transcript) => void): Promise<UnlistenFn> {
  return listen<Transcript>("transcript", (event) => handler(event.payload));
}
