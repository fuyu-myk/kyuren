import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { TurnFailed } from "#agent/failed.ts";
import type { Run as Turn, Transcript } from "#agent/loop.ts";
import { readOf } from "#agent/tools.ts";
import { classify } from "#permission/action.ts";
import { Gate, type AuditEntry } from "#permission/gate.ts";
import { RunLog } from "#playbook/runlog.ts";
import { RunFailed, runPlaybook, shownToJudge, toolsFor, verdictIn, type Ran } from "#playbook/runner.ts";
import { parsePlaybook } from "#playbook/shape.ts";
import { Playbooks } from "#playbook/store.ts";

const BOOK = `---
name: tidy-notes
when: the user asks for the notes to be tidied
inputs:
  - week: which week
skills: [remember, write_file, weather]
version: 1
author: claude-opus-5 on 2026-09-18
---

## Steps

1. Write the week's summary to ~/summary-{{week}}.md.

## Proof

1. file exists: ~/summary-{{week}}.md
2. judged: the summary is in the user's own words
`;

async function setUp() {
  const home = await mkdtemp(join(tmpdir(), "kyuren-runner-"));
  return { home, books: new Playbooks(join(home, "playbooks")), log: new RunLog(join(home, "runs")) };
}

function transcript(called: Transcript["called"], text = "I wrote the summary."): Transcript {
  return { text, difficulty: "hard", route: "cloud", model: "claude-opus-5", reason: "test", steps: 1, called, elapsedMs: 5 };
}

test("an approved playbook runs with the tools it names, is proved, and leaves a log", async () => {
  const { home, books, log } = await setUp();
  books.propose(BOOK);
  books.approve("tidy-notes", "fuyu");

  let offered: string[] | undefined;
  const ran = await runPlaybook({
    books, log, name: "tidy-notes", inputs: { week: "38" }, vault: home, home,
    gate: new Gate(() => [], () => {}), ask: async () => "allow",
    perform: async (turn: Turn) => {
      offered = turn.tools;
      assert.ok(turn.system?.includes(`file exists: ${home}/summary-38.md`), "the proof is in the briefing, filled in");
      assert.ok(turn.system?.includes(`summary to ${home}/summary-38.md`), "so are the steps");
      assert.ok((turn.steps ?? 0) >= 20, "a run has room to search, read and still write");
      await writeFile(join(home, "summary-38.md"), "# Week 38\n");
      return transcript([{ tool: "write_file", target: join(home, "summary-38.md"), effect: "write", ok: true }]);
    },
    judge: async () => true,
  });

  assert.deepEqual(offered?.sort(), ["remember", "skill", "write_file"], "a forged skill is reached through the skill tool");
  assert.equal(ran.run.outcome, "done");
  const text = await readFile(ran.path, "utf8");
  assert.ok(text.includes("write_file") && text.includes("allow"));
  assert.ok(text.includes("passed: file exists"));
});

test("a run whose proof fails is failed, with the item and why", async () => {
  const { home, books, log } = await setUp();
  books.propose(BOOK);
  books.approve("tidy-notes", "fuyu");
  const ran = await runPlaybook({
    books, log, name: "tidy-notes", inputs: { week: "38" }, vault: home, home,
    gate: new Gate(() => [], () => {}), ask: async () => "allow",
    perform: async () => transcript([], "I decided nothing needed writing."),
    judge: async () => true,
  });
  assert.equal(ran.run.outcome, "failed");
  assert.ok(ran.run.closing.includes("does not exist"));
});

test("a pending playbook cannot be run by any path", async () => {
  const { home, books, log } = await setUp();
  books.propose(BOOK);
  await assert.rejects(
    runPlaybook({
      books, log, name: "tidy-notes", inputs: { week: "38" }, vault: home, home,
      gate: new Gate(() => [], () => {}), ask: async () => "allow", perform: async () => transcript([]),
    }),
    /approved/,
  );
});

test("a run without the inputs the playbook asks for does not start", async () => {
  const { home, books, log } = await setUp();
  books.propose(BOOK);
  books.approve("tidy-notes", "fuyu");
  await assert.rejects(
    runPlaybook({
      books, log, name: "tidy-notes", inputs: {}, vault: home, home,
      gate: new Gate(() => [], () => {}), ask: async () => "allow", perform: async () => transcript([]),
    }),
    /needs week/,
  );
});

test("the tools a playbook names are the tools it gets", () => {
  assert.deepEqual(toolsFor(parsePlaybook(BOOK)).sort(), ["remember", "skill", "write_file"]);
});


function child(playbook: string, outcome: "done" | "failed", closing: string): Ran {
  return {
    run: { playbook, startedAt: "2026-09-21T07:30:00.000Z", inputs: {}, route: "cloud", model: "claude-opus-5", calls: [], proof: [], outcome, closing },
    transcript: transcript([]),
    path: `/runs/${playbook}/2026-09-21T07-30-00-000Z.md`,
  };
}

test("a run that starts other runs proves them as its own, and one that failed fails it", async () => {
  const { home, books, log } = await setUp();
  books.propose(BOOK);
  books.approve("tidy-notes", "fuyu");

  const ran = await runPlaybook({
    books, log, name: "tidy-notes", inputs: { week: "38" }, vault: home, home,
    gate: new Gate(() => [], () => {}), ask: async () => "allow",
    perform: async (turn: Turn) => {
      turn.onRan?.(child("child-a", "done", "all well"));
      turn.onRan?.(child("child-b", "failed", "proof failed: ~/b.md does not exist"));
      await writeFile(join(home, "summary-38.md"), "# Week 38\n");
      return transcript([{ tool: "playbooks", target: "child-a, child-b", effect: "execute", ok: true }]);
    },
    judge: async () => true,
  });

  assert.equal(ran.run.outcome, "failed");
  const items = ran.run.proof.map((one) => `${one.passed}: ${one.item}`);
  assert.ok(items.some((one) => one.startsWith("true: sub-run: child-a (")), items.join("\n"));
  assert.ok(items.some((one) => one.startsWith("false: sub-run: child-b (")), items.join("\n"));
  const text = await readFile(ran.path, "utf8");
  assert.ok(text.includes("proof failed: ~/b.md does not exist"), "the child's own reason is in the parent's log");
  assert.match(ran.run.closing, /^proof failed: .*~\/b\.md does not exist/, "and in how it closed");
});


const CITING = `---
name: gathered
when: a test asks for a note drawn from sub-runs
inputs:
  - week: which week
skills: [playbooks, write_file]
version: 1
author: claude-opus-5 on 2026-09-18
---

## Steps

1. Run the sub-runs, then write ~/gathered-{{week}}.md citing what they read.

## Proof

1. file exists: ~/gathered-{{week}}.md
2. cited: ~/gathered-{{week}}.md
`;

test("a note may cite what its sub-runs read, since they read it in the run's name", async () => {
  const { home, books, log } = await setUp();
  books.propose(CITING);
  books.approve("gathered", "fuyu");

  const ran = await runPlaybook({
    books, log, name: "gathered", inputs: { week: "38" }, vault: home, home,
    gate: new Gate(() => [], () => {}), ask: async () => "allow",
    perform: async (turn: Turn) => {
      turn.onRan?.({
        ...child("research", "done", "all well"),
        transcript: transcript([{ tool: "web_fetch", target: "https://a.example/x", effect: "outbound", ok: true }]),
      });
      await writeFile(join(home, "gathered-38.md"), "# Gathered\n\n## Sources\n\n1. [A](https://a.example/x)\n");
      return transcript([]);
    },
  });

  assert.equal(ran.run.outcome, "done", ran.run.proof.map((one) => one.why).join("; "));
});

test("the judge is shown the file the proof is about, not only what was said", async () => {
  const { home, books, log } = await setUp();
  books.propose(BOOK);
  books.approve("tidy-notes", "fuyu");

  let shown: string | undefined;
  const ran = await runPlaybook({
    books, log, name: "tidy-notes", inputs: { week: "38" }, vault: home, home,
    gate: new Gate(() => [], () => {}), ask: async () => "allow",
    perform: async () => {
      await writeFile(join(home, "summary-38.md"), "# Week 38\n\nIn my own words: a quiet week.\n");
      return transcript([{ tool: "write_file", target: join(home, "summary-38.md"), effect: "write", ok: true }], "Wrote it.");
    },
    judge: async (rubric, _transcript, produced) => {
      shown = produced;
      return rubric.includes("own words") && produced.includes("a quiet week");
    },
  });

  assert.equal(ran.run.outcome, "done");
  assert.ok(shown?.includes(`produced: ${join(home, "summary-38.md")}`), "the file is named");
  assert.ok(shown?.includes("In my own words"), "and its text is shown");
});

test("a run's log says what it cost, every step and every sub-run, and how much came from the cache", async () => {
  const { home, books, log } = await setUp();
  books.propose(CITING);
  books.approve("gathered", "fuyu");

  const ran = await runPlaybook({
    books, log, name: "gathered", inputs: { week: "38" }, vault: home, home,
    gate: new Gate(() => [], () => {}), ask: async () => "allow",
    perform: async (turn: Turn) => {
      const sub = child("research", "done", "all well");
      turn.onRan?.({ ...sub, run: { ...sub.run, spent: { input: 1000, output: 100, cacheRead: 600, cacheWrite: 200 } } });
      await writeFile(join(home, "gathered-38.md"), "# Gathered\n");
      return { ...transcript([]), spent: { input: 300, output: 30, cacheRead: 100, cacheWrite: 50 } };
    },
  });

  assert.deepEqual(ran.run.spent, { input: 300, output: 30, cacheRead: 100, cacheWrite: 50 });
  assert.deepEqual(ran.run.spentAll, { input: 1300, output: 130, cacheRead: 700, cacheWrite: 250 });
  const text = await readFile(ran.path, "utf8");
  assert.ok(text.includes("tokens: 300 in, 100 of them from the cache and 50 into it, 30 out"), text.slice(0, 400));
  assert.ok(text.includes("tokens with sub-runs: 1300 in, 700 of them from the cache and 250 into it, 130 out"));
});

const CHECKING_BOOK = `---
name: checking
when: a report needs checking
inputs:
  - report: the report
  - check: where the check goes
skills: [read_file, write_file]
version: 1
author: claude-opus-5 on 2026-10-01
---

## Steps

1. Check {{report}} and write {{check}}.

## Proof

1. file exists: {{check}}
2. judged: every claim listed appears in the report
`;
const CHECKING = parsePlaybook(CHECKING_BOOK);

test("the judge is shown the whole of what was produced and what was given, and told where anything was cut", async () => {
  const { home } = await setUp();
  const report = join(home, "report.md");
  const check = join(home, "check.md");
  await writeFile(report, `# Report\n\n${"a claim. ".repeat(10_000)}\n\n## Sources\n\n1. [A](https://a.example)\n`);
  await writeFile(check, "# Check\n\n| claim | verdict |\n");

  const shown = await shownToJudge(CHECKING, { inputs: { report, check }, home }, async () => true);
  assert.ok(shown.includes(`produced: ${check}`), "the check the proof names");
  assert.ok(shown.includes(`given: ${report}`), "and the report it was given");
  assert.ok(shown.includes("## Sources"), "the whole report, source list and all");
  assert.ok(!shown.includes("cut at"), "nothing this size is cut");

  await writeFile(report, "x".repeat(250_000));
  assert.match(await shownToJudge(CHECKING, { inputs: { report, check }, home }, async () => true), /given: .*report\.md \(cut at 200000 of 250000 characters\)/);
});

test("a judge's reply is read as yes or no and why, and a judge's why reaches the run's log", async () => {
  assert.deepEqual(verdictIn("No\nSource 12 is graded B but is a vendor blog."), { passed: false, why: "Source 12 is graded B but is a vendor blog." });
  assert.deepEqual(verdictIn("**Yes.**\nEvery claim cites a source read in the run."), { passed: true, why: "Every claim cites a source read in the run." });
  assert.equal(verdictIn("").passed, undefined);
  assert.equal(verdictIn("Probably\nhard to say").passed, undefined);

  const { home, books, log } = await setUp();
  books.propose(BOOK);
  books.approve("tidy-notes", "fuyu");
  const ran = await runPlaybook({
    books, log, name: "tidy-notes", inputs: { week: "38" }, vault: home, home,
    gate: new Gate(() => [], () => {}), ask: async () => "allow",
    perform: async () => {
      await writeFile(join(home, "summary-38.md"), "# Week 38\n");
      return transcript([]);
    },
    judge: async () => ({ passed: false, why: "the summary quotes nobody" }),
  });
  assert.equal(ran.run.outcome, "failed");
  assert.ok(ran.run.proof.some((one) => one.why === "judged not to hold: the summary quotes nobody"));
});

test("the judge is never shown a file reading it would have asked about", async () => {
  const { home } = await setUp();
  const report = join(home, "id_rsa");
  const check = join(home, "check.md");
  await writeFile(report, "PRIVATE KEY");
  await writeFile(check, "# Check\n");
  const shown = await shownToJudge(CHECKING, { inputs: { report, check }, home }, async (path) => classify(readOf("judge", path), []) === "allow");
  assert.ok(!shown.includes("PRIVATE KEY"));
  assert.ok(shown.includes(`produced: ${check}`));
});

test("a run started by a turn that holds the user's notes holds them too", async () => {
  const { home, books, log } = await setUp();
  books.propose(BOOK);
  books.approve("tidy-notes", "fuyu");
  const holding: Array<boolean | undefined> = [];
  for (const exposed of [true, false]) {
    await runPlaybook({
      books, log, name: "tidy-notes", inputs: { week: "38" }, vault: home, home, exposed,
      gate: new Gate(() => [], () => {}), ask: async () => "allow",
      perform: async (turn: Turn) => {
        holding.push(turn.exposed);
        return transcript([]);
      },
      judge: async () => true,
    });
  }
  assert.deepEqual(holding, [true, false]);
});

test("a cloud judge is shown a file the run was given from the user's notes only once the user says so", async () => {
  const { home, books, log } = await setUp();
  books.propose(CHECKING_BOOK);
  books.approve("checking", "fuyu");
  const vault = join(home, "vault");
  await mkdir(vault, { recursive: true });
  const report = join(vault, "report.md");
  const check = join(home, "check.md");
  await writeFile(report, "A NOTE OF THE USER'S");
  await writeFile(check, "# Check\n");
  let shown = "";
  const asked: Array<string | undefined> = [];
  await runPlaybook({
    books, log, name: "checking", inputs: { report, check }, vault, home,
    gate: new Gate(() => [{ path: vault, mode: "write" }], () => {}),
    ask: async (_action, why) => {
      asked.push(why);
      return "deny";
    },
    perform: async () => ({ ...transcript([]), route: "cloud" }),
    judge: async (_rubric, _transcript, files) => {
      shown = files;
      return true;
    },
  });
  assert.ok(!shown.includes("A NOTE OF THE USER'S"));
  assert.ok(shown.includes(`produced: ${check}`), "what the run produced is shown as before");
  assert.deepEqual(asked, ["what it reads would go to the cloud model"]);
});

test("a cloud judge is shown a note a proof names only if the run wrote it, or the user says so", async () => {
  const { home, books, log } = await setUp();
  books.propose(CHECKING_BOOK);
  books.approve("checking", "fuyu");
  const vault = join(home, "vault");
  await mkdir(vault, { recursive: true });
  const report = join(home, "report.md");
  const check = join(vault, "check.md");
  await writeFile(report, "# Report\n");
  await writeFile(check, "THE USER'S OWN NOTE");
  const judged = async (wrote: boolean) => {
    let shown = "";
    const asked: Array<string | undefined> = [];
    await runPlaybook({
      books, log, name: "checking", inputs: { report, check }, vault, home,
      gate: new Gate(() => [{ path: vault, mode: "write" }], () => {}),
      ask: async (_action, why) => {
        asked.push(why);
        return "deny";
      },
      perform: async () => ({ ...transcript(wrote ? [{ tool: "write_file", target: check, effect: "write", ok: true }] : []), route: "cloud" }),
      judge: async (_rubric, _transcript, files) => {
        shown = files;
        return true;
      },
    });
    return { shown, asked };
  };
  const untouched = await judged(false);
  assert.ok(!untouched.shown.includes("THE USER'S OWN NOTE"));
  assert.deepEqual(untouched.asked, ["what it reads would go to the cloud model"]);
  const written = await judged(true);
  assert.ok(written.shown.includes("THE USER'S OWN NOTE"), "what the run wrote came from the model already");
  assert.deepEqual(written.asked, []);
});

test("a run started by a turn on the cloud reads as one whose findings go to the cloud", async () => {
  const { home, books, log } = await setUp();
  books.propose(BOOK);
  books.approve("tidy-notes", "fuyu");
  let above: boolean | undefined;
  await runPlaybook({
    books, log, name: "tidy-notes", inputs: { week: "38" }, vault: home, home, cloudAbove: true,
    gate: new Gate(() => [], () => {}), ask: async () => "allow",
    perform: async (turn: Turn) => {
      above = turn.cloudAbove;
      return transcript([]);
    },
    judge: async () => true,
  });
  assert.equal(above, true);
});

test("what the user answers about showing a cloud judge one of their notes is written down", async () => {
  const { home, books, log } = await setUp();
  books.propose(CHECKING_BOOK);
  books.approve("checking", "fuyu");
  const vault = join(home, "vault");
  await mkdir(vault, { recursive: true });
  const report = join(vault, "report.md");
  await writeFile(report, "A NOTE");
  const entries: AuditEntry[] = [];
  await runPlaybook({
    books, log, name: "checking", inputs: { report, check: join(home, "check.md") }, vault, home,
    gate: new Gate(() => [{ path: vault, mode: "write" }], (entry) => void entries.push(entry)),
    ask: async () => "deny",
    perform: async () => ({ ...transcript([]), route: "cloud" }),
    judge: async () => true,
  });
  assert.ok(entries.some((entry) => entry.source === "user" && entry.verdict === "deny" && entry.action.tool === "judge"));
});

test("a judge for a run whose findings go to a turn on the cloud asks before it is shown a note", async () => {
  const { home, books, log } = await setUp();
  books.propose(CHECKING_BOOK);
  books.approve("checking", "fuyu");
  const vault = join(home, "vault");
  await mkdir(vault, { recursive: true });
  const report = join(vault, "report.md");
  await writeFile(report, "A NOTE OF THE USER'S");
  let shown = "";
  const asked: Array<string | undefined> = [];
  await runPlaybook({
    books, log, name: "checking", inputs: { report, check: join(home, "check.md") }, vault, home, cloudAbove: true,
    gate: new Gate(() => [{ path: vault, mode: "write" }], () => {}),
    ask: async (_action, why) => {
      asked.push(why);
      return "deny";
    },
    perform: async () => ({ ...transcript([]), route: "local-large" }),
    judge: async (_rubric, _transcript, files) => {
      shown = files;
      return true;
    },
  });
  assert.ok(!shown.includes("A NOTE OF THE USER'S"), "what it says of the note goes back up to the cloud");
  assert.deepEqual(asked, ["what it reads would go to the cloud model"]);
});

test("a run the model gave up on part way is written down as failed, with every call it made first", async () => {
  const { home, books, log } = await setUp();
  books.propose(BOOK);
  books.approve("tidy-notes", "fuyu");
  const failure = await runPlaybook({
    books, log, name: "tidy-notes", inputs: { week: "38" }, vault: home, home,
    gate: new Gate(() => [], () => {}), ask: async () => "allow",
    perform: async () => {
      throw new TurnFailed("the model stopped answering: credit balance too low", {
        called: [
          { tool: "web_fetch", target: "https://example.com/a", effect: "outbound", ok: true, asked: true },
          { tool: "remember", target: "the week", effect: "read", ok: true },
        ],
        route: "cloud",
        model: "claude-opus-5-5",
        spent: { input: 1000, output: 100, cacheRead: 400, cacheWrite: 200 },
      });
    },
    judge: async () => true,
  }).then(() => undefined, (cause: unknown) => cause);

  assert.ok(failure instanceof RunFailed, "it still fails");
  assert.equal(failure.message, "the model stopped answering: credit balance too low");
  assert.equal(failure.ran.run.outcome, "failed");
  const text = await readFile(failure.ran.path, "utf8");
  assert.ok(text.includes("outcome: failed"));
  assert.ok(text.includes("model: claude-opus-5-5"));
  assert.ok(text.includes("| web_fetch | outbound | https://example.com/a | allow when asked | ok |"));
  assert.ok(text.includes("| remember | read | the week | allow | ok |"));
  assert.ok(text.includes("could not finish: the model stopped answering: credit balance too low"));
  assert.ok(text.includes("tokens: 1000 in, 400 of them from the cache and 200 into it, 100 out"), "what the steps it finished cost");
  assert.deepEqual(log.recent("tidy-notes").map((one) => one.outcome), ["failed"]);
});

test("a run whose log cannot be written fails with why the model stopped, and says it was not written", async () => {
  const { home, books } = await setUp();
  books.propose(BOOK);
  books.approve("tidy-notes", "fuyu");
  await writeFile(join(home, "blocked"), "a file where the folder of runs would be");
  await assert.rejects(
    runPlaybook({
      books, log: new RunLog(join(home, "blocked")), name: "tidy-notes", inputs: { week: "38" }, vault: home, home,
      gate: new Gate(() => [], () => {}), ask: async () => "allow",
      perform: async () => {
        throw new Error("the model stopped answering: overloaded");
      },
    }),
    /^Error: the model stopped answering: overloaded; it could not be written down: /,
  );
});

test("a run that failed before it reached for anything is written down as well", async () => {
  const { home, books, log } = await setUp();
  books.propose(BOOK);
  books.approve("tidy-notes", "fuyu");
  const failure = await runPlaybook({
    books, log, name: "tidy-notes", inputs: { week: "38" }, vault: home, home,
    gate: new Gate(() => [], () => {}), ask: async () => "allow",
    perform: async () => {
      throw new Error("nothing answered");
    },
  }).then(() => undefined, (cause: unknown) => cause);

  assert.ok(failure instanceof RunFailed);
  const text = await readFile(failure.ran.path, "utf8");
  assert.ok(text.includes("outcome: failed") && text.includes("could not finish: nothing answered"));
});
