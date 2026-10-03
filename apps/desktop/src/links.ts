import { invoke } from "@tauri-apps/api/core";
import { insideTauri } from "@/tauri";

/// Follows a link in the user's own browser, never in this window.
export async function openLink(url: string): Promise<void> {
  if (!/^https?:\/\//.test(url)) return;
  if (!insideTauri()) {
    window.open(url, "_blank", "noopener");
    return;
  }
  await invoke("open_link", { url });
}
