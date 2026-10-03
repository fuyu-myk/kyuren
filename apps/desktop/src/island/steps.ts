export type DiffLine = { kind: "@" | " " | "-" | "+"; text: string };
export type Change = { path: string; added: number; removed: number; diff: DiffLine[] };
/// One thing a coding agent did; still being done while it has no outcome.
export type Step = { id: string; verb: string; target: string; ok: boolean | null };
/// A file the session changed, with the steps that changed it, oldest first.
export type FileSummary = { path: string; added: number; removed: number; steps: string[] };
/// The session's last test run, and the step that ran it.
export type TestRun = { step: string; command: string; passed: number | null; failed: number | null; ok: boolean };

/// What a session is doing, as the core reads it from the session's own transcript: everything the
/// first time, then only the steps added or finished since `seq`, within the same `epoch`.
export type Detail = {
  epoch: string;
  seq: number;
  total: number;
  task: string | null;
  branch: string | null;
  steps: Step[];
  files: FileSummary[];
  tests: TestRun | null;
  /// What the agent itself said last: the question it waits on, or how it summed up.
  said: string | null;
};

/// One step opened: what it was given and what came of it, as fits what it did.
export type StepDetail = { ok: boolean | null; output: string[]; earlier: number } & (
  | { kind: "run"; command: string; about: string | null; code: number | null; background: boolean; changes: Change[] }
  | { kind: "edit"; changes: Change[] }
  | { kind: "read"; path: string; from: number | null; lines: number | null; of: number | null; content: string[]; image: boolean }
  | { kind: "agent"; about: string; prompt: string; agent: string | null; steps: Step[] }
  | { kind: "other"; fields: Array<[string, string]> }
);

/// A reading laid over the one had: the steps it has replace theirs and the new ones follow, unless
/// it is of another reading altogether, which it replaces. One with nothing new is the one had, so
/// the island is not drawn again: files and tests change only with a step, which moves `seq`, and
/// the rest is compared.
export function merged(had: Detail | null | undefined, got: Detail): Detail {
  if (!had || had.epoch !== got.epoch) return got;
  const same = got.seq === had.seq && got.task === had.task && got.branch === had.branch && got.said === had.said;
  if (got.steps.length === 0 && same) return had;
  const at = new Map(had.steps.map((one, index) => [one.id, index]));
  const steps = [...had.steps];
  for (const one of got.steps) {
    const index = at.get(one.id);
    if (index === undefined) steps.push(one);
    else steps[index] = one;
  }
  return { ...got, steps };
}
