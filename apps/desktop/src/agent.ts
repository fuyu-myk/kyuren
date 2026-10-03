import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type PermissionRequest = {
  id: string;
  tool: string;
  effect: string;
  target: string;
  /// What would go with it, when that is not in its target.
  carrying?: string;
  /// What makes it a question now, when it would not be one otherwise.
  why?: string;
};

export function onPermission(handler: (request: PermissionRequest) => void): Promise<UnlistenFn> {
  return listen<PermissionRequest>("permission", (event) => handler(event.payload));
}

export function onReply(handler: (reply: string) => void): Promise<UnlistenFn> {
  return listen<string>("agent:reply", (event) => handler(event.payload));
}

export type Chosen = {
  model: string;
  reason: string;
};

export function onRoute(handler: (chosen: Chosen) => void): Promise<UnlistenFn> {
  return listen<Chosen>("agent:route", (event) => handler(event.payload));
}

export function resolvePermission(id: string, allow: boolean): Promise<unknown> {
  return invoke("resolve_permission", { id, allow });
}

export function onTrouble(handler: (message: string) => void): Promise<UnlistenFn> {
  return listen<string>("kyuren:trouble", (event) => handler(event.payload));
}
