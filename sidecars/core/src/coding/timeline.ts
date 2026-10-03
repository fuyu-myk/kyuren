import { randomUUID } from "node:crypto";
import { changesOf, printed } from "#coding/changes.ts";
import { fields, oneLine, record, said, text } from "#coding/said.ts";
import { looksLikeTests, testCounts } from "#coding/testruns.ts";

/// One thing the agent did; still being done while it has no outcome.
export type Step = { id: string; verb: string; target: string; ok: boolean | null };
/// A file the session changed, with the steps that changed it, oldest first.
export type FileSummary = { path: string; added: number; removed: number; steps: string[] };
export type TestRun = { step: string; command: string; passed: number | null; failed: number | null; ok: boolean };
/// Where a line lies in its file, in bytes, so it can be read again alone.
export type Span = { at: number; length: number };

/// What a coding session is doing: the task it was given, what it changed, how its tests last went,
/// and its steps, those added or finished since `seq` when asked again within the same `epoch`.
export type Detail = {
  epoch: string;
  seq: number;
  total: number;
  task: string | null;
  branch: string | null;
  steps: Step[];
  files: FileSummary[];
  tests: TestRun | null;
};

type Pending = { name: string; input: Record<string, unknown> };

/// A session's steps, built up a line at a time as its transcript grows. Each step's own lines are
/// remembered by where they lie rather than kept, so a long session costs little to hold.
export class Timeline {
  readonly epoch = randomUUID();
  readonly #root: string | null;
  /// A subagent's own transcript, every line of which is marked as aside from its parent's.
  readonly #aside: boolean;
  #cwd: string | null = null;
  #task: string | null = null;
  #branch: string | null = null;
  #tests: TestRun | null = null;
  #seq = 0;
  readonly #steps: Step[] = [];
  readonly #changed: number[] = [];
  readonly #index = new Map<string, number>();
  readonly #spans = new Map<string, { use: Span; result?: Span }>();
  readonly #pending = new Map<string, Pending>();
  /// Steps that started work in the background, going until the harness says how it ended.
  readonly #background = new Set<string>();
  /// The harness's own id for each piece of background work, its task's or its agent's, by step.
  readonly #tasks = new Map<string, string>();
  readonly #files = new Map<string, FileSummary>();

  constructor(root: string | null, aside = false) {
    this.#root = root;
    this.#aside = aside;
  }

  /// Files are named from the session's project folder when it is known, since the agent's own
  /// folder moves with every change of directory it makes.
  base(): string | null {
    return this.#root ?? this.#cwd;
  }

  spans(id: string): { use: Span; result?: Span } | undefined {
    return this.#spans.get(id);
  }

  /// How a step went as far as is known, which for work left in the background is more than its
  /// own outcome says.
  okOf(id: string): boolean | null | undefined {
    const index = this.#index.get(id);
    return index === undefined ? undefined : this.#steps[index]?.ok;
  }

  feed(line: string, span: Span): void {
    const one = record(line);
    if (!one) return;
    if (one.type === "last-prompt" && typeof one.lastPrompt === "string") this.#task = oneLine(one.lastPrompt, 200);
    if (typeof one.gitBranch === "string" && one.gitBranch) this.#branch = one.gitBranch;
    if (typeof one.cwd === "string") this.#cwd = one.cwd;
    if (one.isSidechain === true && !this.#aside) return;
    for (const words of noticesIn(one)) this.#ended(words);
    const content = fields(one.message).content;
    if (!Array.isArray(content)) return;
    for (const block of content.map(fields)) {
      if (one.type === "assistant" && block.type === "tool_use") this.#used(block, span);
      if (one.type === "user" && block.type === "tool_result") this.#answered(block, one.toolUseResult, span);
    }
  }

  #used(block: Record<string, unknown>, span: Span): void {
    if (typeof block.id !== "string" || typeof block.name !== "string" || this.#index.has(block.id)) return;
    const input = fields(block.input);
    this.#pending.set(block.id, { name: block.name, input });
    this.#spans.set(block.id, { use: span });
    this.#index.set(block.id, this.#steps.length);
    this.#steps.push({ id: block.id, ...said(block.name, input, this.base()), ok: null });
    this.#changed.push(++this.#seq);
  }

  #answered(block: Record<string, unknown>, result: unknown, span: Span): void {
    const id = typeof block.tool_use_id === "string" ? block.tool_use_id : "";
    const use = this.#pending.get(id);
    const index = this.#index.get(id);
    if (!use || index === undefined) return;
    this.#pending.delete(id);
    const ok = block.is_error !== true;
    this.#spans.set(id, { use: this.#spans.get(id)?.use ?? span, result: span });
    const done = fields(result);
    if (ok && (done.status === "async_launched" || typeof done.backgroundTaskId === "string")) {
      this.#background.add(id);
      const task = typeof done.backgroundTaskId === "string" ? done.backgroundTaskId : text(done, "agentId");
      if (task) this.#tasks.set(task, id);
      return;
    }
    this.#steps[index] = { ...(this.#steps[index] as Step), ok };
    this.#changed[index] = ++this.#seq;
    for (const change of ok ? changesOf(use.name, use.input, result, this.base()) : []) {
      const was = this.#files.get(change.path);
      this.#files.delete(change.path);
      this.#files.set(change.path, {
        path: change.path,
        added: (was?.added ?? 0) + change.added,
        removed: (was?.removed ?? 0) + change.removed,
        steps: [...(was?.steps ?? []), id],
      });
    }
    if (use.name === "Bash" && looksLikeTests(text(use.input, "command"))) {
      const counts = testCounts(printed(result, block));
      this.#tests = { step: id, command: oneLine(text(use.input, "command")), ...counts, ok: ok && (counts.failed ?? 0) === 0 };
    }
  }

  /// The harness's word that work left in the background has ended, and how: a notice with its
  /// status naming the step or the task, or an agent's last report handed back. A notice with no
  /// status is word of progress, not of an end.
  #ended(words: string): void {
    for (const notice of words.split("<task-notification>").slice(1)) {
      const status = /<status>([a-z_]+)<\/status>/.exec(notice)?.[1];
      if (status === undefined) continue;
      const step = /<tool-use-id>([^<]+)<\/tool-use-id>/.exec(notice)?.[1];
      const named = [...this.#tasks].filter(([task]) => notice.includes(task)).map(([, id]) => id);
      for (const id of step === undefined ? named : [step, ...named]) this.#settle(id, status === "completed");
    }
    for (const handed of words.matchAll(/<agent-message from="([^"]+)"/g)) {
      const id = this.#tasks.get(handed[1] ?? "");
      if (id !== undefined) this.#settle(id, true);
    }
  }

  #settle(id: string, ok: boolean): void {
    const index = this.#index.get(id);
    if (index === undefined || !this.#background.delete(id)) return;
    this.#steps[index] = { ...(this.#steps[index] as Step), ok };
    this.#changed[index] = ++this.#seq;
  }

  detail(since: number): Detail {
    return {
      epoch: this.epoch,
      seq: this.#seq,
      total: this.#steps.length,
      task: this.#task,
      branch: this.#branch,
      steps: this.#steps.filter((_, index) => (this.#changed[index] ?? 0) > since),
      files: [...this.#files.values()].reverse(),
      tests: this.#tests,
    };
  }
}

/// Where a line may carry the harness's word about background work: a message to the agent, or a
/// notice queued while it was busy and delivered later.
function noticesIn(one: Record<string, unknown>): string[] {
  if (one.type !== "user" && one.type !== "attachment" && one.type !== "queue-operation") return [];
  const content = fields(one.message).content;
  const said = typeof content === "string" ? [content] : Array.isArray(content) ? content.map((part) => text(fields(part), "text")) : [];
  return [...said, text(fields(one.attachment), "prompt"), text(one, "content")].filter((words) => words.includes("<task-notification>") || words.includes("<agent-message"));
}

/// A timeline of lines read whole, as a test's are.
export function timelineOf(lines: string[], root: string | null = null, aside = false): Timeline {
  const timeline = new Timeline(root, aside);
  let at = 0;
  for (const line of lines) {
    const length = Buffer.byteLength(line);
    timeline.feed(line, { at, length });
    at += length + 1;
  }
  return timeline;
}
