import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { promisify } from "node:util";
import { inShell } from "#playbook/shell.ts";

const run = promisify(execFile);

/// One item of what done looks like. All but the last are checked by machine; the last is handed
/// to a judge, and a proof made only of those is not a proof.
export type ProofItem =
  | { kind: "file"; path: string }
  | { kind: "exit"; command: string }
  | { kind: "contains"; path: string; text: string }
  | { kind: "matches"; path: string; pattern: string }
  | { kind: "json"; path: string }
  | { kind: "cited"; path: string }
  | { kind: "lacks"; path: string; pattern: string }
  | { kind: "numbered"; path: string }
  | { kind: "judged"; rubric: string };

export type Proved = {
  /// Undefined when only a judge can say.
  passed: boolean | undefined;
  why: string;
};

/// What a proof is checked against: the run's inputs, and where a leading tilde points.
export type Where = {
  inputs: Record<string, string>;
  home: string;
  /// Every web address the run actually read, for a proof that what a note cites was fetched.
  fetched?: string[];
};

/// How long a proof's command may take. A proof is a check, not the work.
const PATIENCE = 60_000;

/// A plain POSIX shell, with no arithmetic tests and no arrays, so a value a command compares is
/// only ever compared and never evaluated.
const SHELL = "/bin/dash";

function halves(rest: string, make: (left: string, right: string) => ProofItem): ProofItem | undefined {
  const at = rest.indexOf("::");
  if (at < 0) return undefined;
  return make(rest.slice(0, at).trim(), rest.slice(at + 2).trim());
}

const KINDS: Array<[string, (rest: string) => ProofItem | undefined]> = [
  ["file exists:", (rest) => ({ kind: "file", path: rest })],
  ["exits zero:", (rest) => ({ kind: "exit", command: rest })],
  ["contains:", (rest) => halves(rest, (path, text) => ({ kind: "contains", path, text }))],
  ["matches:", (rest) => halves(rest, (path, pattern) => ({ kind: "matches", path, pattern }))],
  ["json:", (rest) => ({ kind: "json", path: rest })],
  ["cited:", (rest) => ({ kind: "cited", path: rest })],
  ["lacks:", (rest) => halves(rest, (path, pattern) => ({ kind: "lacks", path, pattern }))],
  ["numbered:", (rest) => ({ kind: "numbered", path: rest })],
  ["judged:", (rest) => ({ kind: "judged", rubric: rest })],
];

/// A proof line is a kind, a colon, and what it applies to, in the words a person would write.
export function parseProof(line: string): ProofItem | undefined {
  const text = line.trim();
  const lower = text.toLowerCase();
  for (const [prefix, parse] of KINDS) {
    if (lower.startsWith(prefix)) return parse(text.slice(prefix.length).trim());
  }
  return undefined;
}

/// Inputs fill their braces and a leading tilde is the home given, so a proof written once holds
/// for every run.
export function filled(text: string, where: Where): string {
  return homed(text.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (_, name: string) => where.inputs[name] ?? ""), where.home);
}

function homed(text: string, home: string): string {
  return text.replace(/(^|\s|=)~(?=\/|$)/g, `$1${home}`);
}

async function readOr(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

export async function prove(item: ProofItem, where: Where): Promise<Proved> {
  switch (item.kind) {
    case "file": {
      const path = filled(item.path, where);
      try {
        await stat(path);
        return { passed: true, why: `${path} exists` };
      } catch {
        return { passed: false, why: `${path} does not exist` };
      }
    }
    case "contains": {
      const path = filled(item.path, where);
      const text = await readOr(path);
      if (text === undefined) return { passed: false, why: `${path} could not be read` };
      const wanted = filled(item.text, where);
      return text.includes(wanted)
        ? { passed: true, why: `${path} contains "${wanted}"` }
        : { passed: false, why: `${path} does not contain "${wanted}"` };
    }
    case "matches": {
      const path = filled(item.path, where);
      const text = await readOr(path);
      if (text === undefined) return { passed: false, why: `${path} could not be read` };
      const pattern = filled(item.pattern, where);
      return new RegExp(pattern, "m").test(text)
        ? { passed: true, why: `${path} matches /${pattern}/` }
        : { passed: false, why: `${path} does not match /${pattern}/` };
    }
    case "json": {
      const path = filled(item.path, where);
      const text = await readOr(path);
      if (text === undefined) return { passed: false, why: `${path} could not be read` };
      try {
        JSON.parse(text);
        return { passed: true, why: `${path} is valid JSON` };
      } catch {
        return { passed: false, why: `${path} is not valid JSON` };
      }
    }
    case "exit": {
      const command = filled(item.command, where);
      const inputs = Object.fromEntries(Object.entries(where.inputs).map(([name, value]) => [name, homed(value, where.home)]));
      const placed = inShell(item.command, inputs);
      if ("refused" in placed) return { passed: false, why: `${command}: ${placed.refused}` };
      try {
        await run(SHELL, ["-c", homed(placed.script, where.home)], {
          env: { ...process.env, ...placed.env },
          timeout: PATIENCE,
          maxBuffer: 1 << 20,
        });
        return { passed: true, why: `${command} exited zero` };
      } catch (failure) {
        const code = (failure as { code?: unknown }).code;
        // What bash alone understands fails in dash as a syntax error or a missing command.
        const plain = code === 2 || code === 127 ? ", in a plain POSIX shell, which has no [[ ]], == or <<<" : "";
        return { passed: false, why: `${command} exited ${typeof code === "number" ? code : "badly"}${plain}` };
      }
    }
    case "cited": {
      const path = filled(item.path, where);
      const text = await readOr(path);
      if (text === undefined) return { passed: false, why: `${path} could not be read` };
      const cited = citedIn(text);
      if (cited.length === 0) return { passed: false, why: `${path} cites no sources` };
      const fetched = new Set((where.fetched ?? []).map(plainUrl));
      const unread = cited.filter((one) => !fetched.has(plainUrl(one)));
      return unread.length === 0
        ? { passed: true, why: `every one of ${cited.length} sources cited was read` }
        : { passed: false, why: `cited but never read: ${unread.join(", ")}` };
    }
    case "lacks": {
      const path = filled(item.path, where);
      const text = await readOr(path);
      if (text === undefined) return { passed: false, why: `${path} could not be read` };
      const pattern = filled(item.pattern, where);
      return new RegExp(pattern, "m").test(text)
        ? { passed: false, why: `${path} still matches /${pattern}/` }
        : { passed: true, why: `${path} is free of /${pattern}/` };
    }
    case "numbered": {
      const path = filled(item.path, where);
      const text = await readOr(path);
      if (text === undefined) return { passed: false, why: `${path} could not be read` };
      const wrong = misnumbered(text);
      if (wrong === undefined) return { passed: false, why: `${path} cites nothing inline` };
      return wrong.length === 0
        ? { passed: true, why: `every inline citation in ${path} is its numbered source` }
        : { passed: false, why: wrong.join("; ") };
    }
    case "judged":
      return { passed: undefined, why: `needs judging: ${item.rubric}` };
  }
}

/// Inline citations against the numbered list under Sources: [3](address) must be source 3, at
/// that address. Undefined when nothing is cited inline at all, which is not a report.
export function misnumbered(text: string): string[] | undefined {
  const at = text.search(/^##\s+sources\s*$/im);
  const body = at < 0 ? text : text.slice(0, at);
  const list = at < 0 ? "" : text.slice(at).split(/\n##\s/)[0] ?? "";
  const inline = [...body.matchAll(/\[(\d+)\]\((https?:\/\/[^)\s]+)\)/g)];
  if (inline.length === 0) return undefined;

  const sources = new Map<string, string>();
  for (const line of list.split("\n")) {
    const entry = /^\s*(\d+)[.)]\s+\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/.exec(line);
    if (entry) sources.set(entry[1]!, plainUrl(entry[2]!));
  }

  const wrong: string[] = [];
  const seen = new Set<string>();
  for (const one of inline) {
    const number = one[1]!;
    const url = plainUrl(one[2]!);
    if (seen.has(`${number}|${url}`)) continue;
    seen.add(`${number}|${url}`);
    const listed = sources.get(number);
    if (listed === undefined) wrong.push(`[${number}] has no source ${number}`);
    else if (listed !== url) wrong.push(`[${number}] points at ${url} but source ${number} is ${listed}`);
  }
  return wrong;
}

/// The web addresses listed under a Sources heading, one per line.
export function citedIn(text: string): string[] {
  const at = text.search(/^##\s+sources\s*$/im);
  if (at < 0) return [];
  const section = text.slice(at).split(/\n##\s/)[0] ?? "";
  return [...section.matchAll(/https?:\/\/[^\s)\]>]+/g)].map((one) => one[0]);
}

function plainUrl(url: string): string {
  return url.trim().replace(/[.,;]+$/, "").replace(/\/$/, "").toLowerCase();
}
