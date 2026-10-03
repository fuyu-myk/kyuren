import { invoke } from "@tauri-apps/api/core";

export type Wake = {
  on: boolean;
};

export type WakeState = {
  wanted: Wake;
  live: {
    listening: boolean;
    tracker: string;
    microphone: boolean;
  };
};

/// Whether Kyuren listens for its name. On means the microphone stays open for as long as it is
/// on, which is why it is asked for rather than assumed.
export function wakeListen(on: boolean): Promise<unknown> {
  return invoke("wake_listen", { on });
}

export function wakeState(): Promise<WakeState> {
  return invoke<WakeState>("wake_state");
}
