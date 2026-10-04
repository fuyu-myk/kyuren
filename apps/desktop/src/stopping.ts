import { invoke } from "@tauri-apps/api/core";
import { insideTauri } from "@/tauri";

/// Stops the turn a window is waiting on: a playbook run by the name it was started under, a
/// question by none. Apart from asking, so a window that only asks is not granted stopping.
export async function stopTurn(id?: string): Promise<void> {
  if (!insideTauri()) return;
  await invoke("stop_turn", { id: id ?? null });
}
