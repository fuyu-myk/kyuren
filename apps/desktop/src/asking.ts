import { invoke } from "@tauri-apps/api/core";
import type { Pane } from "@/panes";
import { pretend } from "@/pretend";
import type { Answer, Route } from "@/sessions";
import { insideTauri } from "@/tauri";

/// Asking in writing. A session carries the conversation, and a pane without one starts a session
/// to hold it. Kept apart from the rest of what sessions do, since a window that only asks should
/// be granted only asking.
export async function ask(
  prompt: string,
  where: { session?: string; pane?: Pane },
  route?: Route,
): Promise<Answer> {
  if (!insideTauri()) return pretend.ask(prompt, where);
  return await invoke<Answer>("ask", {
    prompt,
    session: where.session ?? null,
    pane: where.pane ?? null,
    route: route ?? null,
  });
}
