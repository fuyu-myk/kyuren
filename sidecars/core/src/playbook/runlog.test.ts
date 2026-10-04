import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { RunLog } from "#playbook/runlog.ts";

test("a run leaves one file with everything a repair needs to read", async () => {
  const root = await mkdtemp(join(tmpdir(), "kyuren-runs-"));
  const log = new RunLog(root);
  const run = log.begin("weekly-review", { week: "week-38" }, { route: "cloud", model: "claude-opus-5" });
  log.called(run, { tool: "remember", effect: "read", target: "what happened this week", decision: "allow", ok: true });
  log.called(run, { tool: "write_file", effect: "write", target: "~/reviews/week-38.md", decision: "allow", ok: true });
  log.proved(run, [
    { item: "file exists: ~/reviews/week-38.md", passed: true, why: "exists" },
    { item: "contains: ~/reviews/week-38.md :: ## Themes", passed: false, why: "does not contain" },
  ]);
  const path = log.finish(run, "the review had no Themes heading");

  const text = await readFile(path, "utf8");
  assert.ok(path.startsWith(join(root, "weekly-review")), "one folder per playbook");
  assert.ok(text.includes("week-38"), "inputs");
  assert.ok(text.includes("claude-opus-5"), "the model");
  assert.ok(text.includes("remember") && text.includes("write_file"), "every call");
  assert.ok(text.includes("allow"), "the gate's decision on each");
  assert.ok(text.includes("failed") && text.includes("does not contain"), "each proof item and why");
  assert.ok(text.includes("the review had no Themes heading"), "the closing note");
  assert.equal(run.outcome, "failed", "a failed proof is a failed run, never done");

  const recent = log.recent("weekly-review");
  assert.equal(recent.length, 1);
  assert.equal(recent[0]?.outcome, "failed");
});

test("a run whose every proof item passed is done", async () => {
  const log = new RunLog(await mkdtemp(join(tmpdir(), "kyuren-runs-")));
  const run = log.begin("tidy", {}, { route: "local-small", model: "qwen3.5:2b" });
  log.proved(run, [{ item: "exits zero: true", passed: true, why: "exited zero" }]);
  log.finish(run, "");
  assert.equal(run.outcome, "done");
});

test("runs that began in the same instant each keep their own file", async () => {
  const root = await mkdtemp(join(tmpdir(), "kyuren-runs-"));
  const log = new RunLog(root);
  const first = log.begin("research", { question: "a" }, { route: "cloud", model: "claude-opus-5" });
  const second = { ...first, inputs: { question: "b" } };
  const third = { ...first, inputs: { question: "c" } };

  const paths = [log.finish(first, "a"), log.finish(second, "b"), log.finish(third, "c")];
  assert.equal(new Set(paths).size, 3);
  assert.ok((await readFile(paths[1]!, "utf8")).includes("question: b"), "the second run's own file holds its own inputs");
  assert.equal(log.recent("research").length, 3);
});

test("runs are only ever found under a playbook's own name", async () => {
  const log = new RunLog(await mkdtemp(join(tmpdir(), "kyuren-runs-")));
  assert.throws(() => log.recent("../.."), /not a playbook's name/);
  const run = log.begin("../elsewhere", {}, { route: "local", model: "qwen3.5:9b" });
  assert.throws(() => log.finish(run, "done"), /not a playbook's name/);
});

test("a call the user was asked about says so, whichever way they answered", async () => {
  const log = new RunLog(await mkdtemp(join(tmpdir(), "kyuren-runs-")));
  const run = log.begin("tidy", {}, { route: "cloud", model: "claude-opus-5-5" });
  log.called(run, { tool: "write_file", effect: "write", target: "/tmp/a.md", decision: "allow", asked: true, ok: true });
  log.called(run, { tool: "web_fetch", effect: "outbound", target: "https://example.com", decision: "deny", asked: true, ok: false });
  log.called(run, { tool: "remember", effect: "read", target: "the week", decision: "allow", ok: true });
  const text = await readFile(log.finish(run, ""), "utf8");
  assert.ok(text.includes("| write_file | write | /tmp/a.md | allow when asked | ok |"));
  assert.ok(text.includes("| web_fetch | outbound | https://example.com | deny when asked | failed |"));
  assert.ok(text.includes("| remember | read | the week | allow | ok |"));
});

test("a run that could not finish is failed, whatever its proof says", async () => {
  const log = new RunLog(await mkdtemp(join(tmpdir(), "kyuren-runs-")));
  const run = log.begin("tidy", {}, { route: "cloud", model: "claude-opus-5-5" });
  const text = await readFile(log.finish(run, "could not finish: the model stopped answering", true), "utf8");
  assert.equal(run.outcome, "failed");
  assert.equal(log.recent("tidy")[0]?.outcome, "failed");
  assert.match(text, /^finished: no$/m, "said where a reader of the file looks first");
  const done = log.begin("tidy", {}, { route: "cloud", model: "claude-opus-5-5" });
  log.proved(done, [{ item: "exits zero: true", passed: false, why: "exited 1" }]);
  assert.doesNotMatch(await readFile(log.finish(done, "proof failed"), "utf8"), /^finished:/m);
});
