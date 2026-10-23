import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { claudeAnswer, claudeAsk, claudePlanAnswer, PLAN_MOST, waitingFor, type Ask } from "#coding/asked.ts";
import { EDIT_LINES } from "#coding/edits.ts";

const NOW = Date.UTC(2026, 9, 2, 8, 0);

const targetOf = (ask: Ask | undefined) => (ask?.kind === "permission" ? ask.target : undefined);

function request(tool: string, input: Record<string, unknown>) {
  return { session_id: "s1", cwd: "/Users/someone/Code/kyuren", hook_event_name: "PermissionRequest", tool_name: tool, tool_input: input };
}

test("a short command is brought to the island exactly as it would run", () => {
  assert.deepEqual(claudeAsk(request("Bash", { command: "rm -rf build && make", description: "Clean" }), "a1", NOW, 45_000), {
    id: "a1",
    harness: "claude",
    session: "s1",
    project: "kyuren",
    tool: "Bash",
    kind: "permission",
    verb: "run",
    target: "rm -rf build && make",
    at: NOW,
    until: NOW + 45_000,
  });
  assert.equal(targetOf(claudeAsk(request("Read", { file_path: "/Users/someone/Code/kyuren/src/a.ts" }), "a2", NOW, 1)), "src/a.ts");
  assert.equal(targetOf(claudeAsk(request("WebFetch", { url: "https://example.com/a", prompt: "summarise" }), "a3", NOW, 1)), "https://example.com/a");
});

test("whatever the island could not show in full is left to Claude Code's own prompt", () => {
  const leftThere: Array<[string, Record<string, unknown>, string]> = [
    ["Bash", { command: "x".repeat(161) }, "too long to show whole"],
    ["Bash", { command: "echo safe\nrm -rf ~" }, "a second line"],
    ["Bash", { command: "echo ‮evil" }, "a direction override"],
    ["Bash", { command: "rm​ -rf /" }, "a zero-width space"],
    ["Bash", { command: "echo \u001b[2Jhi" }, "a terminal escape"],
    ["Bash", { command: "npm test", dangerouslyDisableSandbox: true }, "the sandbox switched off"],
    ["Bash", { command: "" }, "nothing to show"],
    ["NotebookEdit", { notebook_path: "/Users/someone/Code/kyuren/a.ipynb", new_source: "x" }, "a notebook's cell, not shown"],
    ["mcp__github__create_issue", { title: "x" }, "a plugin's tool, whose arguments are the point"],
    ["ExitPlanMode", {}, "a plan with nothing in it to read"],
    ["AskUserQuestion", { questions: [] }, "choices, which come by the hook before the tool instead"],
  ];
  for (const [tool, input, why] of leftThere) assert.equal(claudeAsk(request(tool, input), "b", NOW, 1), undefined, why);
  assert.equal(claudeAsk({ ...request("Bash", { command: "ls" }), tool_name: "B".repeat(201) }, "b", NOW, 1), undefined);
  assert.equal(claudeAsk({ tool_name: "Bash" }, "b", NOW, 1), undefined, "a request that does not read as one");
  assert.equal(claudeAsk("not json", "b", NOW, 1), undefined);
});

test("an answer is Claude Code's own decision, and leaving it to Claude Code says nothing", () => {
  assert.deepEqual(JSON.parse(claudeAnswer("allow")), { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } } });
  const denied = JSON.parse(claudeAnswer("deny"));
  assert.equal(denied.hookSpecificOutput.decision.behavior, "deny");
  assert.match(denied.hookSpecificOutput.decision.message, /island/);
  assert.equal(claudeAnswer("ask"), "");
});

test("a project's name with something hidden in it is left to Claude Code's own prompt", () => {
  const named = (cwd: string) => claudeAsk({ ...request("Bash", { command: "ls" }), cwd }, "a1", NOW, 1);
  assert.equal(named("/Users/someone/Code/‮evil"), undefined, "a direction override");
  assert.equal(named("/Users/someone/Code/kyu​ren"), undefined, "a zero-width space");
  assert.equal(named("/Users/someone/Code/kyuren")?.project, "kyuren");
});

test("a read of a link is shown as the file it leads to, which is what an answer would let be read", () => {
  const project = mkdtempSync(join(tmpdir(), "kyuren-asked-"));
  const elsewhere = mkdtempSync(join(tmpdir(), "kyuren-elsewhere-"));
  try {
    writeFileSync(join(elsewhere, "id_ed25519"), "key\n");
    symlinkSync(join(elsewhere, "id_ed25519"), join(project, "notes.txt"));
    writeFileSync(join(project, "plain.md"), "plain\n");
    const read = (path: string) => targetOf(claudeAsk({ ...request("Read", { file_path: path }), cwd: project }, "a1", NOW, 1));
    assert.equal(read(join(project, "notes.txt")), realpathSync(join(elsewhere, "id_ed25519")));
    assert.equal(read(join(project, "plain.md")), "plain.md", "a file in the project is still shown where it is in it");
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true });
  }
});

test("blank characters that are not a plain space are left to Claude Code's own prompt, since they can push a command out of view", () => {
  for (const blank of [" ", " ", "　", "⠀", "ㅤ", " "]) {
    assert.equal(claudeAsk(request("Bash", { command: `ls${blank.repeat(20)}; rm -rf ~` }), "a1", NOW, 1), undefined, JSON.stringify(blank));
  }
  const screenshot = "/Users/someone/Code/kyuren/Screenshot 2026-10-03 at 3.45.12 PM.png";
  assert.equal(targetOf(claudeAsk(request("Read", { file_path: screenshot }), "a1", NOW, 1)), "Screenshot 2026-10-03 at 3.45.12 PM.png",
    "the narrow space the Mac puts in a screenshot's name is as plain as a space");
  assert.ok(claudeAsk(request("Bash", { command: "echo 'a\u00A0b'" }), "a1", NOW, 1), "and so is a space that does not break");
});

test("a plan is brought whole, and approving it says the mode it goes on in, for this session alone", () => {
  const plan = "## Refactor the parser\n\n1. Extract the tokenizer.\n2. Test it on its own.";
  const ask = claudeAsk(request("ExitPlanMode", { plan, planFilePath: "/Users/someone/.claude/plans/parser.md" }), "p1", NOW, 115_000);
  assert.deepEqual(ask?.kind === "plan" ? [ask.plan, ask.until] : [], [plan, NOW + 115_000]);
  const said = (answer: Parameters<typeof claudePlanAnswer>[0]) => JSON.parse(claudePlanAnswer(answer) ?? "null")?.hookSpecificOutput?.decision;
  assert.deepEqual(said({ decision: "allow", mode: "acceptEdits" }), { behavior: "allow", updatedPermissions: [{ type: "setMode", mode: "acceptEdits", destination: "session" }] });
  assert.deepEqual(said({ decision: "allow", mode: "default" }).updatedPermissions[0].mode, "default");
  assert.equal(said({ decision: "deny" }).behavior, "deny");
  assert.match(said({ decision: "deny" }).message, /keep planning/);
  assert.equal(claudePlanAnswer({ decision: "ask" }), "");
  assert.equal(claudePlanAnswer({ decision: "allow" }), undefined, "approved without a mode is not an answer");
});

test("a plan too long, or with something hidden in it, is read where it was written", () => {
  assert.equal(claudeAsk(request("ExitPlanMode", { plan: "x".repeat(PLAN_MOST + 1) }), "p", NOW, 1), undefined);
  assert.equal(claudeAsk(request("ExitPlanMode", { plan: "1. Tidy ‮the build" }), "p", NOW, 1), undefined);
  assert.equal(claudeAsk(request("ExitPlanMode", { plan: "1. Tidy\r\n2. Build" }), "p", NOW, 1)?.kind, "plan", "whichever way its lines end");
});

test("an edit is brought with its whole change: what it takes out and what it puts in", () => {
  const project = realpathSync(mkdtempSync(join(tmpdir(), "kyuren-edit-")));
  try {
    writeFileSync(join(project, "a.ts"), "const a = 1;\nconst b = 2;\n");
    const asked = (tool: string, input: Record<string, unknown>) => claudeAsk({ ...request(tool, input), cwd: project }, "e1", NOW, 115_000);
    const edited = asked("Edit", { file_path: join(project, "a.ts"), old_string: "const b = 2;", new_string: "const b = 3;\nconst c = 4;" });
    assert.deepEqual(edited?.kind === "edit" ? { path: edited.path, fresh: edited.fresh, whole: edited.whole, every: edited.every, added: edited.added, removed: edited.removed } : null, {
      path: "a.ts", fresh: false, whole: false, every: false, added: 2, removed: 1,
    });
    assert.deepEqual(edited?.kind === "edit" ? edited.diff : [], [
      { kind: "@", text: "change 1" },
      { kind: "-", text: "const b = 2;" },
      { kind: "+", text: "const b = 3;" },
      { kind: "+", text: "const c = 4;" },
    ]);
    const written = asked("Write", { file_path: join(project, "b.ts"), content: "export {};\n" });
    assert.deepEqual(written?.kind === "edit" ? [written.fresh, written.whole, written.diff] : [], [true, true, [{ kind: "@", text: "a new file" }, { kind: "+", text: "export {};" }]]);
    const everywhere = asked("MultiEdit", {
      file_path: join(project, "a.ts"),
      edits: [{ old_string: "a", new_string: "x", replace_all: true }, { old_string: "b", new_string: "y" }],
    });
    assert.deepEqual(everywhere?.kind === "edit" ? [everywhere.every, everywhere.diff.filter((line) => line.kind === "@").map((line) => line.text)] : [], [
      true,
      ["change 1, wherever it is found", "change 2"],
    ]);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("an edit too long to read on the island, or hiding something, is left to Claude Code's own prompt", () => {
  const file = "/Users/someone/Code/kyuren/a.ts";
  assert.equal(claudeAsk(request("Edit", { file_path: file, old_string: "a", new_string: "b​c" }), "e", NOW, 1), undefined, "a zero-width space in it");
  assert.equal(claudeAsk(request("Write", { file_path: file, content: "x\n".repeat(EDIT_LINES + 1) }), "e", NOW, 1), undefined, "too many lines");
  assert.equal(claudeAsk(request("Edit", { file_path: file, old_string: 1, new_string: "b" }), "e", NOW, 1), undefined, "not text");
});

test("an edit is shown where it would land, its links followed, or else left to Claude Code's own prompt", () => {
  const project = realpathSync(mkdtempSync(join(tmpdir(), "kyuren-landing-")));
  const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), "kyuren-agents-")));
  try {
    writeFileSync(join(project, "a.ts"), "a\n");
    symlinkSync(elsewhere, join(project, "agents"));
    symlinkSync(join(elsewhere, "gone"), join(project, "notes.txt"));
    const written = (file: string) => claudeAsk({ ...request("Write", { file_path: file, content: "x\n" }), cwd: project }, "e", NOW, 1);
    const landed = written(join(project, "agents", "run.plist"));
    assert.deepEqual(landed?.kind === "edit" ? [landed.path, landed.fresh] : [], [join(elsewhere, "run.plist"), true], "a new file in a linked folder, where the link leads");
    const plain = written(join(project, "a.ts"));
    assert.deepEqual(plain?.kind === "edit" ? [plain.path, plain.fresh] : [], ["a.ts", false]);
    const leftThere: Array<[string, string]> = [
      [join(project, "notes.txt"), "a link that leads nowhere, which the write would follow"],
      ["a.ts", "not from the root"],
      ["~/.zshrc", "nor from home"],
      [`${project}/src/../a.ts`, "a step back"],
      [`${project}/./a.ts`, "a step in place"],
      [`${project}/`, "a folder"],
    ];
    for (const [file, why] of leftThere) assert.equal(written(file), undefined, why);
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true });
  }
});

test("an edit through a link to a name that hides something is left to Claude Code's own prompt", () => {
  const project = realpathSync(mkdtempSync(join(tmpdir(), "kyuren-landing-")));
  const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), "kyuren-hidden-")));
  try {
    mkdirSync(join(elsewhere, "evil\u202Etxt.gnp"));
    symlinkSync(join(elsewhere, "evil\u202Etxt.gnp"), join(project, "docs"));
    assert.equal(claudeAsk({ ...request("Write", { file_path: join(project, "docs", "new.md"), content: "x\n" }), cwd: project }, "e", NOW, 1), undefined);
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true });
  }
});

test("a change that only takes out, or only puts in, shows no line it does not have", () => {
  const project = realpathSync(mkdtempSync(join(tmpdir(), "kyuren-edit-")));
  try {
    writeFileSync(join(project, "a.ts"), "foo\nbar\n");
    const edited = (old: string, put: string) => claudeAsk({ ...request("Edit", { file_path: join(project, "a.ts"), old_string: old, new_string: put }), cwd: project }, "e", NOW, 1);
    const out = edited("foo\nbar\n", "");
    assert.deepEqual(out?.kind === "edit" ? [out.diff.map((line) => line.kind), out.added, out.removed] : [], [["@", "-", "-"], 0, 2]);
    const put = edited("", "baz\n");
    assert.deepEqual(put?.kind === "edit" ? [put.diff.map((line) => line.kind), put.added, put.removed] : [], [["@", "+"], 1, 0]);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("a replacement made everywhere is read as Claude Code reads it, and one that cannot be told is left to it", () => {
  const project = realpathSync(mkdtempSync(join(tmpdir(), "kyuren-edit-")));
  try {
    writeFileSync(join(project, "a.ts"), "a a\n");
    const told = (everywhere: unknown) => {
      const ask = claudeAsk({ ...request("Edit", { file_path: join(project, "a.ts"), old_string: "a", new_string: "b", replace_all: everywhere }), cwd: project }, "e", NOW, 1);
      return ask?.kind === "edit" ? ask.every : undefined;
    };
    assert.deepEqual([told(true), told("true"), told(false), told("false"), told(undefined)], [true, true, false, false, false]);
    assert.equal(told(1), undefined);
    assert.equal(told("yes"), undefined);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("a plan that also asks for permissions is approved where they are shown", () => {
  const prompts = [{ tool: "Bash", prompt: "run tests" }];
  assert.equal(claudeAsk(request("ExitPlanMode", { plan: "1. Test it.", allowedPrompts: prompts }), "p", NOW, 1), undefined);
  assert.equal(claudeAsk(request("ExitPlanMode", { plan: "1. Test it.", allowedPrompts: [] }), "p", NOW, 1)?.kind, "plan", "asking for none");
});

test("a mark drawn as nothing, such as a variation selector, hides as much as any other", () => {
  const file = "/Users/someone/Code/kyuren/a.ts";
  assert.equal(claudeAsk(request("Bash", { command: "cat README.md\uFE0F" }), "a", NOW, 1), undefined);
  assert.equal(claudeAsk(request("ExitPlanMode", { plan: "1. Tidy\u034F the build" }), "p", NOW, 1), undefined);
  assert.equal(claudeAsk(request("Edit", { file_path: file, old_string: "a", new_string: "b\u{E0100}" }), "e", NOW, 1), undefined);
});

test("what a session is waiting for names no file, since the event log keeps it", () => {
  const edit: Ask = { id: "e", harness: "claude", session: "s", project: "kyuren", tool: "Edit", at: 0, until: 1, kind: "edit", path: "src/secret-plans.ts", fresh: false, whole: false, every: false, diff: [], added: 0, removed: 0 };
  assert.equal(waitingFor(edit), "permission to edit a file");
  assert.equal(waitingFor({ ...edit, fresh: true }), "permission to create a file");
});
