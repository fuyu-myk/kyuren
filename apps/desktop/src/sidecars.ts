import { invoke } from "@tauri-apps/api/core";

export type Probe =
  | { ok: true; result: { name: string; version: string; uptimeMs: number } }
  | { ok: false; error: string };

export type Status = {
  core: Probe;
  perception: Probe;
};

export function readStatus(): Promise<Status> {
  return invoke<Status>("sidecar_status");
}
