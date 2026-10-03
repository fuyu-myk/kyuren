import type { Ask } from "#agent/tool.ts";
import type { Item, Source, Span } from "#connect/source.ts";
import type { Gate } from "#permission/gate.ts";
import type { Action } from "#permission/action.ts";

export type Gathered = {
  items: Item[];
  read: string[];
  refused: string[];
  unavailable: string[];
  failed: Array<{ source: string; reason: string }>;
};

/// Reading a service is an action that leaves the machine, so it is judged like any other. The
/// origin is the target, which is what keeps one service's approval from covering the next.
export function readingAction(source: Source): Action {
  return { tool: source.name, effect: source.effect, target: source.origin };
}

/// Without someone to ask, a question is a refusal. Reading that happens on its own, with nobody
/// at the keyboard, must never raise a prompt: it reads what has already been allowed and reports
/// the rest as not yet allowed.
async function permitted(source: Source, gate: Gate, ask: Ask | undefined): Promise<boolean> {
  const action = readingAction(source);
  let resolution = gate.decide(action);

  if (resolution.verdict === "ask" && ask) {
    gate.remember(action, await ask(action));
    resolution = gate.decide(action);
  }

  return resolution.verdict === "allow";
}

/// One source failing is not the brief failing. What could not be read is reported alongside what
/// could, so the answer can say what it is missing instead of pretending to be complete.
export async function gather(
  sources: Source[],
  span: Span,
  gate: Gate,
  ask?: Ask,
): Promise<Gathered> {
  const gathered: Gathered = { items: [], read: [], refused: [], unavailable: [], failed: [] };

  for (const source of sources) {
    if (!(await source.available())) {
      gathered.unavailable.push(source.name);
      continue;
    }

    if (!(await permitted(source, gate, ask))) {
      gathered.refused.push(source.name);
      continue;
    }

    try {
      gathered.items.push(...(await source.read(span)));
      gathered.read.push(source.name);
    } catch (failure) {
      gathered.failed.push({
        source: source.name,
        reason: failure instanceof Error ? failure.message : String(failure),
      });
    }
  }

  gathered.items.sort((a, b) => a.at.localeCompare(b.at));
  return gathered;
}
