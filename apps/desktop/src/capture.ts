import { invoke } from "@tauri-apps/api/core";

export type Capture = {
  path: string;
  width: number;
  height: number;
};

/// One frame of the screen, taken because someone asked for it. Nothing here is continuous and
/// nothing here is sent anywhere: the file stays on this machine.
export function captureScreen(): Promise<Capture> {
  return invoke<Capture>("capture_screen");
}
