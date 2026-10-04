import { invoke } from "@tauri-apps/api/core";

export type Recent = { path: string; startedAt: string; outcome: "done" | "failed" | "unjudged" };

export type Listed = {
  name: string;
  approved: boolean;
  pending: boolean;
  when: string;
  /// What a run is given: the first from the words typed after it, the rest found or asked for.
  inputs: Array<{ name: string; about: string }>;
  recent: Recent[];
};

export type Proof = { kind: string; [key: string]: unknown };

export type Playbook = {
  name: string;
  when: string;
  version: number;
  author: string;
  approved: string | undefined;
  steps: string[];
  proof: Proof[];
  notes: string[];
};

export type Read = {
  name: string;
  approved: Playbook | undefined;
  pending: Playbook | undefined;
  diff: string;
};

export function listPlaybooks(): Promise<Listed[]> {
  return invoke<{ playbooks: Listed[] }>("playbooks_list").then((reply) => reply.playbooks);
}

export function readPlaybook(name: string): Promise<Read> {
  return invoke<Read>("playbook_read", { name });
}

export function approvePlaybook(name: string): Promise<unknown> {
  return invoke("playbook_approve", { name });
}

export function rejectPlaybook(name: string): Promise<unknown> {
  return invoke("playbook_reject", { name });
}

export function playbookRuns(name: string): Promise<Recent[]> {
  return invoke<{ runs: Recent[] }>("playbook_runs", { name }).then((reply) => reply.runs);
}

export type Repaired = { name: string; pending: boolean; diff: string; said: string };

export function repairPlaybook(name: string): Promise<Repaired> {
  return invoke<Repaired>("playbook_repair", { name });
}

export type ProofResult = { item: string; passed: boolean | undefined; why: string };

export type Invoked = {
  outcome: "done" | "failed" | "unjudged";
  proof: ProofResult[];
  log: string;
  said: string;
  inputs: Record<string, string>;
  produced?: { path: string; text: string };
  /// What is shown as the reply: the produced file, then the outcome.
  answer: string;
  session?: string;
};

/// A slash command: the playbook by name and the words typed after it, kept as a conversation
/// in the pane it was typed in. Given a name, the run can be stopped by it.
export function invokePlaybook(name: string, text: string, pane: string, id?: string): Promise<Invoked> {
  return invoke<Invoked>("playbook_invoke", { name, text, pane, id: id ?? null });
}
