/// A walk back through what was sent: which prompt is shown, and what was being written before the
/// walk began, given back once the walk comes forward past the newest.
export type Walk = { at: number; draft: string } | undefined;

/// One step back (-1) or forward (1) through the prompts sent, oldest first. Nothing when there is
/// nowhere further to go, so the key does what it would have done.
export function recalled(sent: string[], walk: Walk, step: -1 | 1, typed: string): { walk: Walk; text: string } | undefined {
  const at = walk?.at ?? sent.length;
  const next = at + step;
  if (next < 0 || next > sent.length || (walk === undefined && step === 1)) return undefined;
  const draft = walk?.draft ?? typed;
  if (next === sent.length) return { walk: undefined, text: draft };
  return { walk: { at: next, draft }, text: sent[next]! };
}

/// The prompts a session's turns sent, oldest first, one said twice in a row kept once.
export function sentIn(turns: Array<{ role: string; text: string }>): string[] {
  return turns
    .filter((one) => one.role === "user")
    .map((one) => one.text)
    .filter((text, at, all) => at === 0 || all[at - 1] !== text);
}
