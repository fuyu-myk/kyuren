import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type AmbientRule = {
  id: string;
  when: "event" | "message" | "task";
  voice: boolean;
};

/// A playbook run at a time of day, from the rules file, with when it is next due.
export type Scheduled = {
  id: string;
  playbook: string;
  at: string;
  on?: string[];
  next: string;
  last?: { at: string; why: string };
};

export type AmbientState = {
  file: string;
  enabled: boolean;
  every: number;
  read: string[];
  rules: AmbientRule[];
  schedules: Scheduled[];
  trouble?: string;
  lastLook?: {
    at: string;
    fired: number;
    read: string[];
    notAllowed: string[];
    trouble?: string;
  };
};

export type Firing = {
  rule: string;
  voice: boolean;
  title: string;
  why: string;
  at: string;
  /// When the thing itself is, for an event or a due task.
  when?: string;
};

/// What Kyuren may notice on its own: the rules the user wrote, and what those rules have caused.
export function ambientState(): Promise<AmbientState> {
  return invoke<AmbientState>("ambient_state");
}

export function ambientRecent(limit = 8): Promise<Firing[]> {
  return invoke<Firing[]>("ambient_recent", { limit });
}

export function ambientLook(): Promise<unknown> {
  return invoke("ambient_look");
}

/// Every look and every firing, as they happen, so the presence section is never a picture of an
/// earlier moment.
export async function onPresence(handler: () => void): Promise<UnlistenFn> {
  const stops = await Promise.all([
    listen("presence:looked", () => handler()),
    listen("presence:notice", () => handler()),
  ]);
  return () => {
    for (const stop of stops) stop();
  };
}
