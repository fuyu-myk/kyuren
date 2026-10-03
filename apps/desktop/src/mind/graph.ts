import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Drawn, Edge } from "@/mind/render";
import type { Reading } from "@/mind/reach";
import { sketch } from "@/mind/sketch";
import { insideTauri } from "@/tauri";

export { insideTauri };

export type Incoming = { nodes: Drawn[]; links: Edge[] };

type Reply = {
  nodes?: Drawn[];
  links?: Edge[];
};

/// What Kyuren remembers and what it can do. Asked for together, because a graph missing a layer
/// looks like a graph that lost one.
export async function readGraph(): Promise<Incoming> {
  if (!insideTauri()) return sketch(Number(new URLSearchParams(location.search).get("sketch")) || 1);

  const [memory, capability] = await Promise.all([
    invoke<Reply>("mind_graph").catch(() => ({}) as Reply),
    invoke<Reply>("known_capabilities").catch(() => ({}) as Reply),
  ]);

  return {
    nodes: [...(memory.nodes ?? []), ...(capability.nodes ?? [])],
    links: memory.links ?? [],
  };
}

export type Step = {
  step: string;
  tool: string;
  target: string;
};

export function onStep(handler: (step: Step) => void): Promise<UnlistenFn> {
  return listen<Step>("mind:step", (event) => handler(event.payload));
}

export function onStepDone(handler: (step: { step: string; ok: boolean }) => void): Promise<UnlistenFn> {
  return listen<{ step: string; ok: boolean }>("mind:step-done", (event) => handler(event.payload));
}

/// Which capabilities can be asked for on their own. Kyuren decides, so the mind never offers to
/// run something that would amount to asking nothing.
export async function askable(): Promise<string[]> {
  if (!insideTauri()) return ["today", "remember"];
  const asked = await invoke<Array<{ name: string }>>("askable_capabilities");
  return asked.map((one) => one.name);
}

/// The same request the hotkey and the tray item make, so that closing the mind from inside it is
/// the same act as closing it from outside.
export function toggleMind(): Promise<void> {
  return invoke<void>("show_mind");
}

export async function runCapability(tool: string): Promise<string> {
  const answer = await invoke<{ spoken?: string; text?: string }>("run_capability", {
    tool,
    pane: null,
  });
  return answer.spoken ?? answer.text ?? "";
}

/// One hand, as the perception sidecar read it. The camera's picture never leaves that process:
/// what arrives here is a point and a word for what the hand is doing.
export function onHand(handler: (reading: Reading) => void): Promise<UnlistenFn> {
  return listen<Reading>("mind:hand", (event) => handler(event.payload));
}

export function onHandLost(handler: () => void): Promise<UnlistenFn> {
  return listen("mind:hand-lost", () => handler());
}

/// Whether the camera is actually open, as the process holding it says so. What was asked for
/// and what is running are not the same thing, and the light beside the camera follows this one.
export function onSight(handler: (open: boolean) => void): Promise<UnlistenFn> {
  return listen<boolean>("mind:sight", (event) => handler(event.payload));
}

export async function startVision(): Promise<boolean> {
  if (!insideTauri()) return false;
  const answer = await invoke<{ open?: boolean }>("start_vision");
  return answer.open === true;
}

export async function stopVision(): Promise<void> {
  if (!insideTauri()) return;
  await invoke<void>("stop_vision");
}
