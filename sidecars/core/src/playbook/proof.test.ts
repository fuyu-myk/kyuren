import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseProof, prove } from "#playbook/proof.ts";

test("a proof line names its kind and what it applies to", () => {
  assert.deepEqual(parseProof("file exists: ~/notes/{{week}}.md"), { kind: "file", path: "~/notes/{{week}}.md" });
  assert.deepEqual(parseProof("exits zero: node --version"), { kind: "exit", command: "node --version" });
  assert.deepEqual(parseProof("contains: ~/a.md :: ## Themes"), { kind: "contains", path: "~/a.md", text: "## Themes" });
  assert.deepEqual(parseProof("matches: ~/a.md :: ^Week \\d+"), { kind: "matches", path: "~/a.md", pattern: "^Week \\d+" });
  assert.deepEqual(parseProof("json: ~/a.json"), { kind: "json", path: "~/a.json" });
  assert.deepEqual(parseProof("lacks: ~/a.md :: \\[unsupported\\]"), { kind: "lacks", path: "~/a.md", pattern: "\\[unsupported\\]" });
  assert.deepEqual(parseProof("numbered: ~/a.md"), { kind: "numbered", path: "~/a.md" });
  assert.deepEqual(parseProof("judged: every person is named"), { kind: "judged", rubric: "every person is named" });
  assert.equal(parseProof("something else entirely"), undefined);
});

test("machine checks pass and fail on what is actually there", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kyuren-proof-"));
  await writeFile(join(dir, "week-38.md"), "# Week 38\n\n## Themes\n\nsignals\n");
  await writeFile(join(dir, "data.json"), "{\"ok\": true}");
  const at = { inputs: { week: "week-38" }, home: dir };

  assert.equal((await prove({ kind: "file", path: "~/{{week}}.md" }, at)).passed, true);
  assert.equal((await prove({ kind: "file", path: "~/week-39.md" }, at)).passed, false);
  assert.equal((await prove({ kind: "contains", path: "~/{{week}}.md", text: "## Themes" }, at)).passed, true);
  assert.equal((await prove({ kind: "contains", path: "~/{{week}}.md", text: "## Actions" }, at)).passed, false);
  assert.equal((await prove({ kind: "matches", path: "~/{{week}}.md", pattern: "^# Week \\d+" }, at)).passed, true);
  assert.equal((await prove({ kind: "json", path: "~/data.json" }, at)).passed, true);
  assert.equal((await prove({ kind: "json", path: "~/{{week}}.md" }, at)).passed, false);
  assert.equal((await prove({ kind: "exit", command: "test -f ~/{{week}}.md" }, at)).passed, true);
  assert.equal((await prove({ kind: "exit", command: "exit 3" }, at)).passed, false);
});

test("what only a judge can check is handed back, not guessed", async () => {
  const proved = await prove({ kind: "judged", rubric: "every person is named" }, { inputs: {}, home: "/tmp" });
  assert.equal(proved.passed, undefined);
  assert.ok(proved.why.includes("every person is named"));
});

test("a note's sources count as cited only if every one of them was read in the run", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kyuren-cited-"));
  await writeFile(join(dir, "note.md"), "# Q\n\nAnswer.\n\n## Sources\n\n- https://a.example/one\n- https://b.example/two/\n");
  const read = { inputs: {}, home: dir, fetched: ["https://a.example/one", "https://b.example/two"] };
  assert.equal((await prove({ kind: "cited", path: "~/note.md" }, read)).passed, true);
  const half = { inputs: {}, home: dir, fetched: ["https://a.example/one"] };
  const proved = await prove({ kind: "cited", path: "~/note.md" }, half);
  assert.equal(proved.passed, false);
  assert.ok(proved.why.includes("b.example"));
  assert.deepEqual(parseProof("cited: ~/note.md"), { kind: "cited", path: "~/note.md" });
});


test("a report's inline citations must each be their numbered source, and a marker must be gone", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kyuren-proof-"));
  const good = [
    "# Q", "", "## Findings", "", "A fact [1](https://a.example/x). Another [2](https://b.example/y).", "",
    "## Sources", "", "1. [A](https://a.example/x), paper", "2. [B](https://b.example/y/), blog", "",
  ].join("\n");
  await writeFile(join(dir, "good.md"), good);
  await writeFile(
    join(dir, "bad.md"),
    good.replace("[1](https://a.example/x)", "[1](https://c.example/z)").replace("[2](https://b.example/y)", "[3](https://b.example/y)").replace("Another", "[unsupported] Another"),
  );
  await writeFile(join(dir, "none.md"), "# Q\n\n## Sources\n\n1. [A](https://a.example/x)\n");
  const at = { inputs: {}, home: dir };

  assert.equal((await prove({ kind: "numbered", path: "~/good.md" }, at)).passed, true, "a trailing slash is the same address");
  const bad = await prove({ kind: "numbered", path: "~/bad.md" }, at);
  assert.equal(bad.passed, false);
  assert.match(bad.why, /\[1\] points at https:\/\/c.example\/z but source 1 is/);
  assert.match(bad.why, /\[3\] has no source 3/);
  assert.equal((await prove({ kind: "numbered", path: "~/none.md" }, at)).passed, false, "citing nothing inline is not a report");

  assert.equal((await prove({ kind: "lacks", path: "~/good.md", pattern: "\\[unsupported\\]" }, at)).passed, true);
  assert.equal((await prove({ kind: "lacks", path: "~/bad.md", pattern: "\\[unsupported\\]" }, at)).passed, false);
});

test("an input is put in a command as a value, never as more of the command, wherever its braces stand", async () => {
  const home = await mkdtemp(join(tmpdir(), "kyuren-proof-"));
  const marker = join(home, "ran");
  const where = {
    home,
    inputs: { sub: `$(touch ${marker})`, closer: `'; touch ${marker}; echo '`, plain: "it's here" },
  };
  for (const command of ["test -n {{sub}}", 'test -n "{{sub}}"', "test -n '{{closer}}'"]) {
    await prove({ kind: "exit", command }, where);
  }
  assert.equal(existsSync(marker), false, "a value's own quotes and substitutions were run as a command");

  await writeFile(join(home, "note.md"), "it's here\n");
  for (const command of ["grep -qF {{plain}} ~/note.md", 'grep -qF "{{plain}}" ~/note.md', "grep -qF '{{plain}}' ~/note.md"]) {
    const proved = await prove({ kind: "exit", command }, where);
    assert.equal(proved.passed, true, `${command}: ${proved.why}`);
  }
  assert.match((await prove({ kind: "exit", command: 'grep -qF "{{plain}}" ~/note.md' }, where)).why, /it's here/,
    "what is said of it reads as the command did, filled");
});

test("an input is never put where the shell would read it again, nor where a test does arithmetic with it", async () => {
  const home = await mkdtemp(join(tmpdir(), "kyuren-proof-"));
  const marker = join(home, "ran");
  const where = { home, inputs: { t: `zzz -o -exec touch ${marker} ;`, n: `a[$(touch ${marker})]` } };
  const nested = await prove({ kind: "exit", command: `test -z "$(find ${home} -name "{{t}}")"` }, where);
  assert.equal(nested.passed, false);
  assert.match(nested.why, /substitution/);
  await prove({ kind: "exit", command: "[[ {{n}} -eq 1 ]]" }, where);
  await prove({ kind: "exit", command: "test {{n}} -eq 1" }, where);
  assert.equal(existsSync(marker), false, "nothing an input said was run");
});

test("a tilde an input starts with is the home the proof is checked against", async () => {
  const home = await mkdtemp(join(tmpdir(), "kyuren-proof-"));
  await writeFile(join(home, "n.md"), "x\n");
  assert.equal((await prove({ kind: "exit", command: "test -s {{report}}" }, { home, inputs: { report: "~/n.md" } })).passed, true);
});

test("a command written for bash says it ran in a plain POSIX shell, so a repair knows why it failed", async () => {
  const home = await mkdtemp(join(tmpdir(), "kyuren-proof-"));
  const proved = await prove({ kind: "exit", command: "[[ -d ~ ]]" }, { home, inputs: {} });
  assert.equal(proved.passed, false);
  assert.match(proved.why, /POSIX shell/);
});
