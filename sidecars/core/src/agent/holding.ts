import { NOTES_READ, type Ask } from "#agent/tool.ts";
import type { Action } from "#permission/action.ts";
import type { Gate } from "#permission/gate.ts";
import { route, type Decision, type Demand } from "#model/route.ts";

/// The route a turn takes once a conversation that holds the user's notes has been asked whether
/// they may go to the cloud with it, as they would with its first words: refused, it stays on this
/// machine.
export async function routeHolding(decision: Decision, held: boolean, demand: Demand, ask: Ask, gate: Gate): Promise<Decision> {
  if (!held || decision.route !== "cloud") return decision;
  const going: Action = {
    tool: "model",
    effect: "outbound",
    target: "the cloud model",
    carrying: "this conversation, which holds your notes",
  };
  const answer = await ask(going, NOTES_READ);
  gate.once(going, answer);
  return answer === "allow" ? decision : route({ ...demand, sensitive: true });
}
