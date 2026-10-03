import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/// Credentials go straight to the system keychain through the core process. They are never held in
/// component state beyond the keystroke that enters them, and reading them back is not offered.
export function storeSecret(name: string, secret: string): Promise<string[]> {
  return invoke<string[]>("store_secret", { name, secret });
}

export function forgetSecret(name: string): Promise<string[]> {
  return invoke<string[]>("forget_secret", { name });
}

export function heldSecrets(): Promise<string[]> {
  return invoke<string[]>("held_secrets");
}

/// Starts a service's consent in the browser. The grant returns to a loopback listener in the core
/// process, so nothing is typed back into Kyuren and the code never leaves the machine.
export function connectService(
  service: string,
  clientId: string,
  clientSecret?: string,
): Promise<void> {
  return invoke("connect_service", { service, clientId, clientSecret });
}

export function onConnections(handler: (names: string[]) => void): Promise<UnlistenFn> {
  return listen<string[]>("connections", (event) => handler(event.payload));
}

export type Brief = {
  facts: string;
  read: string[];
  refused: string[];
  unavailable: string[];
  failed: Array<{ source: string; reason: string }>;
};

export function morningBrief(): Promise<Brief> {
  return invoke<Brief>("morning_brief");
}

/// Shows the mind over everything, or hides it if it is already there.
export function showMind(): Promise<void> {
  return invoke("show_mind");
}
