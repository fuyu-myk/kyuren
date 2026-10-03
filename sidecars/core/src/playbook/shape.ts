import { frontmatter } from "#memory/frontmatter.ts";
import { parseProof, type ProofItem } from "#playbook/proof.ts";

export type Input = { name: string; about: string };

/// One written procedure for one kind of task, with what done looks like written beside it.
export type Playbook = {
  name: string;
  /// The requests it is for, in plain words.
  when: string;
  inputs: Input[];
  skills: string[];
  version: number;
  author: string;
  /// By whom and when, or undefined while it waits.
  approved: string | undefined;
  steps: string[];
  proof: ProofItem[];
  notes: string[];
};

/// The body cut into its named parts by second-level heading, keyed by the heading in lowercase.
function sections(body: string): Map<string, string> {
  const found = new Map<string, string[]>();
  let current: string | undefined;
  for (const line of body.split(/\r?\n/)) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      current = (heading[1] ?? "").toLowerCase();
      found.set(current, []);
      continue;
    }
    if (current !== undefined) found.get(current)?.push(line);
  }
  return new Map([...found].map(([name, lines]) => [name, lines.join("\n")]));
}

/// List items, numbered or dashed, with a line that runs on folded into the item before it.
function items(text: string): string[] {
  const found: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const item = /^\s*(?:\d+[.)]|[-*])\s+(.*)$/.exec(line);
    if (item) {
      found.push((item[1] ?? "").trim());
      continue;
    }
    if (line.trim() === "" || found.length === 0) continue;
    found[found.length - 1] = `${found[found.length - 1]} ${line.trim()}`;
  }
  return found;
}

/// A playbook's name is also the name of its file and of its runs' folder, so it is a few
/// lowercase words joined by dashes and never something that could climb out of either.
const NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function isName(name: string): boolean {
  return NAME.test(name);
}

export function named(name: string): string {
  if (!isName(name)) throw new Error(`${JSON.stringify(name)} is not a playbook's name, which is a few lowercase words joined by dashes`);
  return name;
}

export function parsePlaybook(markdown: string): Playbook {
  const { body, fields } = frontmatter(markdown);
  const name = fields.name?.[0];
  if (!name) throw new Error("a playbook needs a name");
  named(name);
  const when = fields.when?.join(", ") ?? "";
  if (when === "") throw new Error(`playbook ${name} needs to say when it applies`);

  const parts = sections(body);
  const steps = items(parts.get("steps") ?? "");
  if (steps.length === 0) throw new Error(`playbook ${name} needs steps`);

  const proof = items(parts.get("proof") ?? "").map((line) => {
    const item = parseProof(line);
    if (!item) throw new Error(`playbook ${name} has a proof item that is not understood: ${line}`);
    return item;
  });
  if (proof.length === 0) throw new Error(`playbook ${name} needs a proof`);

  return {
    name,
    when,
    inputs: (fields.inputs ?? []).map((one) => {
      const at = one.indexOf(":");
      return at < 0
        ? { name: one.trim(), about: "" }
        : { name: one.slice(0, at).trim(), about: one.slice(at + 1).trim() };
    }),
    skills: fields.skills ?? [],
    version: Number(fields.version?.[0] ?? 1) || 1,
    author: fields.author?.[0] ?? "unknown",
    approved: fields.approved?.[0],
    steps,
    proof,
    notes: items(parts.get("notes") ?? ""),
  };
}

/// Whether a playbook may be approved at all. A proof made only of judgements is one the model
/// can talk itself past, so it is refused before anyone is asked.
export function approvable(book: Playbook): { ok: boolean; why?: string } {
  if (!book.proof.some((one) => one.kind !== "judged")) {
    return { ok: false, why: "every proof item is a judgement, which is a proof the model can talk itself past" };
  }
  return { ok: true };
}

/// What a repair may change and what it may not. It may change how the work is done, what proves
/// it and what was learnt; it may not change what the playbook is or give itself tools it did
/// not have. A step planted in a run log cannot smuggle in a new skill this way, and a playbook
/// that needs new skills is a new playbook, proposed on its own.
export function acceptable(before: Playbook, after: Playbook): { ok: boolean; why?: string } {
  if (after.name !== before.name) return { ok: false, why: "a repair keeps the playbook's name" };
  const added = after.skills.filter((one) => !before.skills.includes(one));
  if (added.length > 0) {
    return { ok: false, why: `a repair may not give itself new skills: ${added.join(", ")}` };
  }
  return { ok: true };
}
