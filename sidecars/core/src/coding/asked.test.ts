import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { claudeAnswer, claudeAsk } from "#coding/asked.ts";

const NOW = Date.UTC(2026, 9, 2, 8, 0);

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
    verb: "run",
    target: "rm -rf build && make",
    at: NOW,
    until: NOW + 45_000,
  });
  assert.equal(claudeAsk(request("Read", { file_path: "/Users/someone/Code/kyuren/src/a.ts" }), "a2", NOW, 1)?.target, "src/a.ts");
  assert.equal(claudeAsk(request("WebFetch", { url: "https://example.com/a", prompt: "summarise" }), "a3", NOW, 1)?.target, "https://example.com/a");
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
    ["Edit", { file_path: "/Users/someone/Code/kyuren/a.ts", old_string: "a", new_string: "b" }, "an edit, whose change is the point"],
    ["Write", { file_path: "/etc/hosts", content: "x" }, "a whole file written"],
    ["mcp__github__create_issue", { title: "x" }, "a plugin's tool, whose arguments are the point"],
    ["ExitPlanMode", { plan: "..." }, "a plan to read"],
    ["AskUserQuestion", { questions: [] }, "choices to pick from"],
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
    const read = (path: string) => claudeAsk({ ...request("Read", { file_path: path }), cwd: project }, "a1", NOW, 1)?.target;
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
  assert.equal(claudeAsk(request("Read", { file_path: screenshot }), "a1", NOW, 1)?.target, "Screenshot 2026-10-03 at 3.45.12 PM.png",
    "the narrow space the Mac puts in a screenshot's name is as plain as a space");
  assert.ok(claudeAsk(request("Bash", { command: "echo 'a\u00A0b'" }), "a1", NOW, 1), "and so is a space that does not break");
});
