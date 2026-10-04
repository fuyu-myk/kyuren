import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { named } from "#playbook/shape.ts";

export type Call = {
  tool: string;
  effect: string;
  target: string;
  decision: "allow" | "deny";
  /// The question was put, rather than the gate deciding from its policy, an earlier answer or the
  /// run's allowance.
  asked?: boolean;
  ok: boolean;
};

export type ProofResult = {
  item: string;
  passed: boolean | undefined;
  why: string;
};

/// Tokens, and how many of those read came from the cache or went into it, which is what a price
/// is reckoned from: a cached read costs a fraction of a fresh one.
export type Spent = { input: number; output: number; cacheRead: number; cacheWrite: number };

export function added(one: Spent | undefined, other: Spent | undefined): Spent | undefined {
  if (!one) return other;
  if (!other) return one;
  return {
    input: one.input + other.input,
    output: one.output + other.output,
    cacheRead: one.cacheRead + other.cacheRead,
    cacheWrite: one.cacheWrite + other.cacheWrite,
  };
}

function counted(spent: Spent): string {
  return `${spent.input} in, ${spent.cacheRead} of them from the cache and ${spent.cacheWrite} into it, ${spent.output} out`;
}

export type Outcome = "done" | "failed" | "unjudged";

export type Run = {
  playbook: string;
  startedAt: string;
  inputs: Record<string, string>;
  route: string;
  model: string;
  /// What the run cost in tokens, every step of it, as the model reported it, so a run's price is
  /// a fact rather than a guess.
  spent?: Spent;
  /// The same, with what every sub-run it started cost added in.
  spentAll?: Spent;
  /// How many sub-runs it started.
  children?: number;
  calls: Call[];
  proof: ProofResult[];
  outcome: Outcome;
  closing: string;
  path?: string;
};

export type Recent = { path: string; startedAt: string; outcome: Outcome };

/// One markdown file per run, under a folder per playbook: what went in, which model ran it,
/// every call and what the gate said to it, every proof item and why, and a closing note. It is
/// what a repair reads, and what a person reads when they want to know what happened.
export class RunLog {
  private readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  begin(
    playbook: string,
    inputs: Record<string, string>,
    on: { route: string; model: string; spent?: Spent; spentAll?: Spent; children?: number },
  ): Run {
    return {
      playbook,
      startedAt: new Date().toISOString(),
      inputs,
      route: on.route,
      model: on.model,
      ...(on.spent ? { spent: on.spent } : {}),
      ...(on.spentAll ? { spentAll: on.spentAll } : {}),
      ...(on.children ? { children: on.children } : {}),
      calls: [],
      proof: [],
      outcome: "unjudged",
      closing: "",
    };
  }

  called(run: Run, call: Call): void {
    run.calls.push(call);
  }

  proved(run: Run, results: ProofResult[]): void {
    run.proof = results;
  }

  /// Writes the run down and says how it ended. A single failed proof item fails the run: done
  /// is a fact about every item, not an impression of the whole. A run that could not finish
  /// failed, whatever its proof would have said.
  finish(run: Run, closing: string, unfinished = false): string {
    run.closing = closing;
    run.outcome = unfinished || run.proof.some((one) => one.passed === false)
      ? "failed"
      : run.proof.some((one) => one.passed === undefined)
        ? "unjudged"
        : "done";

    const dir = join(this.root, named(run.playbook));
    mkdirSync(dir, { recursive: true });
    const stem = run.startedAt.replace(/[:.]/g, "-");
    // Runs that began in the same instant, as sub-runs do, would share a name; each keeps its own.
    let path = join(dir, `${stem}.md`);
    for (let more = 2; existsSync(path); more += 1) path = join(dir, `${stem}-${more}.md`);
    writeFileSync(path, render(run), "utf8");
    run.path = path;
    return path;
  }

  recent(playbook: string, most = 10): Recent[] {
    const dir = join(this.root, named(playbook));
    let files: string[];
    try {
      files = readdirSync(dir).filter((one) => one.endsWith(".md")).sort().reverse().slice(0, most);
    } catch {
      return [];
    }
    return files.map((file) => {
      const text = readFileSync(join(dir, file), "utf8");
      const outcome = /^outcome: (done|failed|unjudged)$/m.exec(text)?.[1] as Outcome | undefined;
      const startedAt = /^started: (.+)$/m.exec(text)?.[1] ?? "";
      return { path: join(dir, file), startedAt, outcome: outcome ?? "unjudged" };
    });
  }
}

function render(run: Run): string {
  const inputs = Object.entries(run.inputs).map(([name, value]) => `- ${name}: ${value}`).join("\n") || "- none";
  const calls = run.calls.length
    ? run.calls.map((one) => `| ${one.tool} | ${one.effect} | ${one.target} | ${one.decision}${one.asked ? " when asked" : ""} | ${one.ok ? "ok" : "failed"} |`).join("\n")
    : "| none | | | | |";
  const proof = run.proof.length
    ? run.proof.map((one, at) => `${at + 1}. ${one.passed === true ? "passed" : one.passed === false ? "failed" : "unjudged"}: ${one.item} (${one.why})`).join("\n")
    : "none";
  return `---
playbook: ${run.playbook}
started: ${run.startedAt}
route: ${run.route}
model: ${run.model}
${run.spent ? `tokens: ${counted(run.spent)}\n` : ""}${run.spentAll && run.children ? `tokens with sub-runs: ${counted(run.spentAll)}\n` : ""}outcome: ${run.outcome}
---

## Inputs

${inputs}

## Calls

| tool | effect | target | gate | result |
| --- | --- | --- | --- | --- |
${calls}

## Proof

${proof}

## Closing

${run.closing || "nothing to add"}
`;
}
