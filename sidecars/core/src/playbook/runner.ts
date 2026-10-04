import { generateText } from "ai";
import { TurnFailed } from "#agent/failed.ts";
import type { Called, Run as Turn, Transcript, Watching } from "#agent/loop.ts";
import { NOTES_TO_CLOUD, type Ask } from "#agent/tool.ts";
import { readOf } from "#agent/tools.ts";
import { modelFor, optionsFor } from "#model/providers.ts";
import { ROUTES, type Route } from "#model/route.ts";
import type { Gate } from "#permission/gate.ts";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { filled, prove, type ProofItem, type Where } from "#playbook/proof.ts";
import { added, type ProofResult, type Run, type RunLog } from "#playbook/runlog.ts";
import type { Playbook } from "#playbook/shape.ts";
import type { Playbooks } from "#playbook/store.ts";

export type Performer = (turn: Turn) => Promise<Transcript>;
/// A judge's answer: whether the rubric holds, undefined when it could not say, and why.
export type Judged = boolean | undefined | { passed: boolean | undefined; why: string };

/// Judges a rubric by what was said, what was called, and the files themselves: the ones the
/// proof names and the ones the run was given, since a rubric about a report is about the report.
export type Judge = (rubric: string, transcript: Transcript, shown: string) => Promise<Judged>;

export type Running = {
  books: Playbooks;
  log: RunLog;
  name: string;
  inputs: Record<string, string>;
  vault: string;
  home: string;
  gate: Gate;
  ask: Ask;
  /// The agent loop, handed in rather than imported, since the loop offers a tool that runs this.
  perform: Performer;
  judge?: Judge;
  watching?: Watching;
  signal?: AbortSignal;
  sensitive?: boolean;
  /// Whether whatever started the run holds the user's notes, which its inputs may then carry.
  exposed?: boolean;
  /// Whether what the run finds goes back to a turn on the cloud.
  cloudAbove?: boolean;
};

export type Ran = {
  run: Run;
  transcript: Transcript;
  path: string;
};

/// A run that could not finish, already written down as failed, so whoever started it can point
/// at its log rather than at nothing.
export class RunFailed extends Error {
  readonly ran: Ran;

  constructor(reason: string, ran: Ran, cause: unknown) {
    super(reason, { cause });
    this.ran = ran;
  }
}

function logged(log: RunLog, run: Run, called: Called[]): void {
  for (const one of called) {
    log.called(run, {
      tool: one.tool,
      effect: one.effect ?? "",
      target: one.target,
      decision: one.refused ? "deny" : "allow",
      ...(one.asked ? { asked: true } : {}),
      ok: one.ok ?? false,
    });
  }
}

/// A run that started others answers for them: each is an item of its proof, and one that
/// failed fails it.
function subRuns(children: Ran[]): ProofResult[] {
  return children.map((child) => ({
    item: `sub-run: ${child.run.playbook} (${child.path})`,
    passed: child.run.outcome === "done" ? true : child.run.outcome === "failed" ? false : undefined,
    why: child.run.outcome === "done"
      ? "its proof passed"
      : child.run.outcome === "failed"
        ? child.run.closing
        : "not everything in it could be judged",
  }));
}

/// A run the model gave up on part way, written down all the same: the calls it made were made,
/// and the log is where a repair, and a person, look to see what happened.
function abandoned(options: Running, name: string, failure: unknown, children: Ran[]): RunFailed {
  const reason = failure instanceof Error ? failure.message : String(failure);
  const turn = failure instanceof TurnFailed ? failure : undefined;
  const run = options.log.begin(name, options.inputs, {
    route: turn?.route ?? "unknown",
    model: turn?.model ?? "unknown",
    children: children.length,
  });
  logged(options.log, run, turn?.called ?? []);
  options.log.proved(run, subRuns(children));
  const path = options.log.finish(run, `could not finish: ${reason}`, true);
  const transcript: Transcript = {
    text: "",
    difficulty: "hard",
    route: turn?.route ?? "cloud",
    model: turn?.model ?? "",
    reason: "",
    steps: 0,
    called: turn?.called ?? [],
    elapsedMs: 0,
    exposed: turn?.exposed === true || children.some((child) => child.transcript.exposed === true),
  };
  return new RunFailed(reason, { run, transcript, path }, failure);
}

/// The tools that exist under their own names. A skill named in a playbook that is not one of
/// these is a forged skill, reached through the skill tool.
const NATIVE = new Set([
  "read_file", "list_directory", "write_file", "add_to_notion", "project", "code", "forge",
  "skill", "remember", "today", "playbook", "playbooks", "web_search", "web_fetch",
]);

/// The tools an approved playbook may use without a question per target: reaching the web to
/// read, and running other approved playbooks. Approving a playbook that names them is the
/// consent, and the run log lists every address read and every run started.
const STANDING = ["web_search", "web_fetch", "playbook", "playbooks"] as const;

/// How many tool calls a run may make. Two searches and six pages is eight, which is a chat
/// turn's whole budget, and the note was never written; a run needs room to finish, and a check
/// that reads thirty sources again needs more.
const STEPS = 48;

/// How much of each file the judge is shown, and of all of them together. Whole files: a judge
/// shown half a report cannot see its source list, and says no to a rubric about the sources.
const SHOWN_EACH = 200_000;
const SHOWN_ALL = 400_000;

/// Room for the judge to think before it answers. Its thinking counts against this, and a judge
/// that runs out of room says nothing at all.
const JUDGE_ROOM = 8_000;

export function toolsFor(book: Playbook): string[] {
  const wanted = new Set<string>();
  for (const name of book.skills) wanted.add(NATIVE.has(name) ? name : "skill");
  return [...wanted];
}

export function proofLine(item: ProofItem): string {
  switch (item.kind) {
    case "file": return `file exists: ${item.path}`;
    case "exit": return `exits zero: ${item.command}`;
    case "contains": return `contains: ${item.path} :: ${item.text}`;
    case "matches": return `matches: ${item.path} :: ${item.pattern}`;
    case "json": return `json: ${item.path}`;
    case "cited": return `cited: ${item.path}`;
    case "lacks": return `lacks: ${item.path} :: ${item.pattern}`;
    case "numbered": return `numbered: ${item.path}`;
    case "judged": return `judged: ${item.rubric}`;
  }
}

/// What the model is told before it starts: the playbook as written, with the inputs beside it,
/// and the proof it will be checked against, so it works towards done rather than plausible.
/// Placeholders and the tilde are filled in first: a model shown {{date}} has copied it into a
/// file name, and one shown ~ has guessed at homes it does not have.
export function briefing(book: Playbook, inputs: Record<string, string>, home: string): string {
  const where = { inputs, home };
  const given = Object.entries(inputs).map(([name, value]) => `- ${name}: ${value}`).join("\n") || "- none";
  const steps = book.steps.map((one, at) => `${at + 1}. ${filled(one, where)}`).join("\n");
  const proof = book.proof.map((one, at) => `${at + 1}. ${filled(proofLine(one), where)}`).join("\n");
  const notes = book.notes.length
    ? `\n\nLessons from earlier runs:\n${book.notes.map((one) => `- ${one}`).join("\n")}`
    : "";
  return `You are running the playbook "${book.name}", version ${book.version}. Follow its steps in order, using only the tools you are offered, and stop when the proof below would pass.

Inputs:
${given}

Steps:
${steps}

Proof, which will be checked when you finish:
${proof}${notes}`;
}

async function readOr(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

/// The files a judge is shown: the ones the proof names, which the run produced, and any input
/// that names a file, which the run was given to work on. A check of a report is judged against
/// the report as well as the check. A file too long to show whole says where it was cut. A judge's
/// prompt can leave the machine, so only a file that `may` be shown is.
export async function shownToJudge(
  book: Playbook,
  where: Where,
  may: (path: string) => Promise<boolean>,
): Promise<string> {
  const files: Array<[path: string, as: "produced" | "given"]> = [];
  const seen = new Set<string>();
  const add = (path: string, as: "produced" | "given") => {
    if (!seen.has(path)) {
      seen.add(path);
      files.push([path, as]);
    }
  };
  for (const item of book.proof) {
    if (item.kind === "judged" || item.kind === "exit") continue;
    add(filled(item.path, where), "produced");
  }
  for (const value of Object.values(where.inputs)) {
    const path = filled(value.trim(), where);
    if (path.startsWith("/")) add(path, "given");
  }

  const shown: string[] = [];
  let total = 0;
  for (const [path, as] of files) {
    if (!(await may(path))) continue;
    const text = await readOr(path);
    if (text === undefined) continue;
    const part = text.slice(0, Math.min(SHOWN_EACH, SHOWN_ALL - total));
    if (part.length === 0) break;
    total += part.length;
    const cut = part.length < text.length ? ` (cut at ${part.length} of ${text.length} characters)` : "";
    shown.push(`--- ${as}: ${path}${cut} ---\n${part}`);
  }
  return shown.join("\n\n");
}

/// A judge's reply: yes or no on the first line, why on the next.
export function verdictIn(text: string): { passed: boolean | undefined; why: string } {
  const lines = text.trim().split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const word = (lines[0] ?? "").toLowerCase().replace(/^[^a-z]+/, "");
  const passed = word.startsWith("yes") ? true : word.startsWith("no") ? false : undefined;
  return { passed, why: lines.slice(1).join(" ").slice(0, 400) };
}

function settled(judged: Judged): { passed: boolean | undefined; why: string } {
  return typeof judged === "object" ? judged : { passed: judged, why: "" };
}

/// The judge a run uses unless it is given one: the run's own route, asked whether the rubric
/// holds of the files, and why.
export function judgeWith(route: string): Judge {
  const chosen = (ROUTES as readonly string[]).includes(route) ? (route as Route) : "local-small";
  return async (rubric, transcript, shown) => {
    try {
      const said = await generateText({
        model: modelFor(chosen, "moderate"),
        prompt: `Does the following hold of the work described? Answer yes or no on the first line and nothing else on that line. On the second line, say in one sentence why, naming what fails if it does not hold.\n\nRubric: ${rubric}\n\nWhat was said when it was done:\n${transcript.text.slice(0, 4000)}\n\nTools used: ${transcript.called.map((one) => `${one.tool} on ${one.target}`).join("; ") || "none"}${shown ? `\n\nThe files:\n${shown}` : ""}`,
        maxOutputTokens: JUDGE_ROOM,
        maxRetries: 4,
        providerOptions: optionsFor(chosen),
        abortSignal: AbortSignal.timeout(180_000),
      });
      const verdict = verdictIn(said.text);
      if (verdict.passed === undefined && said.finishReason === "length") {
        return { passed: undefined, why: "it ran out of room before it answered" };
      }
      return verdict;
    } catch (failure) {
      return { passed: undefined, why: failure instanceof Error ? failure.message.slice(0, 200) : String(failure) };
    }
  };
}

/// Runs an approved playbook: briefs the model, lets it work with the tools the playbook names,
/// then checks every proof item and writes the run down. Only approved playbooks can be read, so
/// a pending one cannot arrive here by any path.
export async function runPlaybook(options: Running): Promise<Ran> {
  const book = options.books.read(options.name);
  if (!book) throw new Error(`there is no approved playbook named ${options.name}`);

  const missing = book.inputs.filter((one) => !(one.name in options.inputs)).map((one) => one.name);
  if (missing.length > 0) throw new Error(`playbook ${book.name} needs ${missing.join(", ")}`);

  const withdraw = STANDING.filter((one) => book.skills.includes(one)).map((one) =>
    options.gate.allow(one, one === "playbook" || one === "playbooks" ? "execute" : "outbound"),
  );
  const children: Ran[] = [];
  let transcript: Transcript;
  try {
    transcript = await options.perform({
      prompt: "Run the playbook now. When you are done, say in a few lines what you did and where the results are.",
      vault: options.vault,
      system: briefing(book, options.inputs, options.home),
      difficulty: "hard",
      gate: options.gate,
      ask: options.ask,
      watching: options.watching,
      signal: options.signal,
      sensitive: options.sensitive,
      exposed: options.exposed,
      cloudAbove: options.cloudAbove,
      tools: toolsFor(book),
      steps: STEPS,
      onRan: (child) => children.push(child),
    });
  } catch (failure) {
    throw abandoned(options, book.name, failure, children);
  } finally {
    for (const done of withdraw) done();
  }
  // What was read includes what the sub-runs read: a report drawn from their notes cites the
  // pages they fetched, and those were fetched in this run's name.
  const fetched = [transcript, ...children.map((child) => child.transcript)].flatMap((one) =>
    one.called.filter((call) => call.tool === "web_fetch" && call.ok).map((call) => call.target),
  );

  const run = options.log.begin(book.name, options.inputs, {
    route: transcript.route,
    model: transcript.model,
    spent: transcript.spent,
    spentAll: children.reduce((sum, child) => added(sum, child.run.spentAll ?? child.run.spent), transcript.spent),
    children: children.length,
  });
  logged(options.log, run, transcript.called);

  const judge = options.judge ?? judgeWith(transcript.route);
  const where = { inputs: options.inputs, home: options.home, fetched };
  // A file read without asking may be shown, but on the cloud, or where what the judge says goes on
  // to the cloud, one of the user's notes is shown only with a yes: only what the run itself wrote
  // came from the model already.
  const toCloud = transcript.route === "cloud" || options.cloudAbove === true;
  const wrote = new Set(transcript.called.filter((one) => one.tool === "write_file" && one.ok).map((one) => resolve(one.target)));
  const may = async (path: string) => {
    const action = readOf("judge", path);
    if (options.gate.decide(action).verdict !== "allow") return false;
    if (!toCloud || wrote.has(resolve(path)) || !options.gate.holdsNotes(action)) return true;
    return options.gate.once(action, await options.ask(action, NOTES_TO_CLOUD)).verdict === "allow";
  };
  const shown = book.proof.some((one) => one.kind === "judged") ? await shownToJudge(book, where, may) : "";
  const results: ProofResult[] = [];
  for (const item of book.proof) {
    if (item.kind === "judged") {
      const verdict = settled(await judge(item.rubric, transcript, shown));
      const said = verdict.passed === undefined ? "the judge gave no answer" : verdict.passed ? "judged to hold" : "judged not to hold";
      results.push({
        item: proofLine(item),
        passed: verdict.passed,
        why: verdict.why ? `${said}: ${verdict.why}` : said,
      });
      continue;
    }
    const proved = await prove(item, where);
    results.push({ item: proofLine(item), passed: proved.passed, why: proved.why });
  }
  const proven = [...results, ...subRuns(children)];
  options.log.proved(run, proven);

  const failed = proven.filter((one) => one.passed === false);
  const closing = failed.length > 0
    ? `proof failed: ${failed.map((one) => one.why).join("; ")}`
    : transcript.text.slice(0, 400);
  const path = options.log.finish(run, closing);
  return { run, transcript, path };
}
