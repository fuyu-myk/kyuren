import { invoke } from "@tauri-apps/api/core";
import type { Pane } from "@/panes";
import { insideTauri } from "@/tauri";
import { pretend } from "@/pretend";

export const ROUTES = ["local-small", "local-large", "cloud"] as const;
export type Route = (typeof ROUTES)[number];

export type Usage = { input: number; output: number };

/// What answered a turn and how much context it read.
export type Answered = { model: string; route: string; usage?: Usage };

export type Session = {
  id: string;
  pane: Pane;
  title: string;
  started: number;
  touched: number;
  turns: number;
  /// The route the user chose for this conversation. None means the router decides.
  preferred?: Route;
};

export type Turn = {
  role: "user" | "assistant";
  text: string;
  at: number;
  by?: Answered;
};

export type Capability = {
  id: string;
  label: string;
  description?: string;
  pane: Pane;
};

/// One reach for a tool during a turn, so an answer can say how it was arrived at.
export type Called = {
  tool: string;
  target: string;
  ok?: boolean;
};

export type Answer = {
  text: string;
  spoken?: string;
  session?: string;
  model: string;
  route: string;
  reason: string;
  steps: number;
  called?: Called[];
  elapsedMs: number;
  /// What the turn cost in tokens; the input is the context the model read.
  usage?: Usage;
};

export type ModelOption = { route: Route; model: string; available: boolean };

/// A capability that is a whole request, and the words it is asked in.
export type Asked = {
  name: string;
  asking: string;
};

export async function listSessions(pane?: Pane): Promise<Session[]> {
  if (!insideTauri()) return pretend.list(pane);
  const reply = await invoke<{ sessions: Session[] }>("session_list", { pane: pane ?? null });
  return reply.sessions;
}

export async function readSession(id: string): Promise<{ session: Session; turns: Turn[] }> {
  if (!insideTauri()) return pretend.read(id);
  return await invoke<{ session: Session; turns: Turn[] }>("session_read", { id });
}

/// Keeps the route the user chose for a conversation, or clears it to let the router decide.
export async function preferSession(id: string, route: Route | undefined): Promise<void> {
  if (!insideTauri()) return pretend.prefer(id, route);
  await invoke("session_prefer", { id, route: route ?? null });
}

export async function startSession(pane: Pane, title?: string): Promise<Session> {
  if (!insideTauri()) return pretend.start(pane, title);
  const reply = await invoke<{ session: Session }>("session_start", { pane, title: title ?? null });
  return reply.session;
}

export async function renameSession(id: string, title: string): Promise<void> {
  if (!insideTauri()) return pretend.rename(id, title);
  await invoke("session_rename", { id, title });
}

export async function forgetSession(id: string): Promise<void> {
  if (!insideTauri()) return pretend.forget(id);
  await invoke("session_forget", { id });
}

export { ask } from "@/asking";

/// The routes a turn may take and the model behind each, as the core sees them now.
export async function modelOptions(): Promise<ModelOption[]> {
  if (!insideTauri()) {
    return [
      { route: "local-small", model: "qwen3.5:2b", available: true },
      { route: "local-large", model: "qwen3.5:9b", available: true },
      { route: "cloud", model: "claude-opus-5-5", available: true },
    ];
  }
  return (await invoke<{ options: ModelOption[] }>("model_options")).options;
}

export async function capabilities(): Promise<Capability[]> {
  if (!insideTauri()) return pretend.capabilities();
  const reply = await invoke<{ nodes: Capability[] }>("known_capabilities");
  return reply.nodes;
}

/// Runs a capability on its own. Given a pane, what it says is kept there as a session.
export async function runCapability(tool: string, pane?: Pane, id?: string): Promise<Answer> {
  if (!insideTauri()) return pretend.ask(`run ${tool}`, { pane });
  const answer = await invoke<Answer>("run_capability", { tool, pane: pane ?? null, id: id ?? null });
  return { ...answer, text: answer.spoken ?? answer.text ?? "" };
}

export type Parameter = {
  name: string;
  in: "path" | "query" | "header" | "body";
  kind: "string" | "number" | "boolean";
  required: boolean;
  about: string;
};

export type Skill = {
  id: string;
  name: string;
  about: string;
  method: string;
  url: string;
  parameters: Parameter[];
  headers: Record<string, string>;
  auth: { mode: "none" | "bearer" | "header" | "query"; credential?: string };
  reads: "json" | "text";
  state: "pending" | "approved" | "broken";
  drafted: number;
  approved?: number;
  trouble?: string;
};

export async function listSkills(): Promise<Skill[]> {
  if (!insideTauri()) return pretend.skills();
  const reply = await invoke<{ skills: Skill[] }>("skills_list", { state: null });
  return reply.skills;
}

/// Approving a skill, which is the only thing that makes one callable.
export async function approveSkill(id: string): Promise<void> {
  if (!insideTauri()) return pretend.approveSkill(id);
  await invoke("skill_approve", { id });
}

export async function forgetSkill(id: string): Promise<void> {
  if (!insideTauri()) return pretend.forgetSkill(id);
  await invoke("skill_forget", { id });
}

export type Project = {
  name: string;
  path: string;
  branch: string;
  upstream?: string;
  ahead: number;
  behind: number;
  dirty: number;
  lastAt?: number;
  lastSaid?: string;
};

/// Where every project stands. Asked for whenever the pane is looked at and on a timer, which the
/// core answers from its last reading unless it is asked for a fresh one.
export async function projectBoard(fresh = false): Promise<Project[]> {
  if (!insideTauri()) return pretend.projects();
  const reply = await invoke<{ projects: Project[] }>("project_board", { fresh });
  return reply.projects;
}

export async function askable(): Promise<Asked[]> {
  if (!insideTauri()) {
    return [
      { name: "today", asking: "What does today hold?" },
      { name: "remember", asking: "What have I written down lately?" },
    ];
  }
  return await invoke<Asked[]>("askable_capabilities");
}
