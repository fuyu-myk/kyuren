/// A coding agent's permission question, held on the island until it is answered here or handed
/// back to the agent to ask in its own way.
export type AgentAsk = {
  id: string;
  harness: string;
  session: string;
  project: string;
  tool: string;
  verb: string;
  target: string;
  at: number;
  until: number;
};

export type Decision = "allow" | "deny" | "ask";

/// Seconds until the agent stops waiting and asks itself.
export function secondsLeft(ask: AgentAsk, now: number): number {
  return Math.max(0, Math.ceil((ask.until - now) / 1000));
}

/// Sessions waiting on the user for something other than a question already on the island.
export function waitingBesides(sessions: Array<{ id: string; state: string }>, asks: AgentAsk[]): number {
  return sessions.filter((one) => one.state === "waiting" && !asks.some((ask) => ask.session === one.id)).length;
}
