import assert from "node:assert/strict";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { claudeCommand, claudeHookState, hasClaudeHook, quoted, setClaudeHook, withClaudeHook, withoutClaudeHook } from "#coding/install.ts";

const RELAY = "/Users/someone/.kyuren/bin/kyuren-hook";
const SOCKET = "/Users/someone/.kyuren/hooks/kyuren.sock";
const COMMAND = claudeCommand(RELAY, SOCKET);

/// The user's own settings, as they might stand: a hook of their own, and much else.
function theirs(): Record<string, unknown> {
  return {
    effortLevel: "high",
    hooks: {
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "$HOME/.claude/hooks/guard-bash.sh" }] }],
    },
    model: "opus",
    permissions: { allow: ["Bash(git status)"] },
  };
}

function places(): { claude: string; kyuren: string; relay: string } {
  const root = mkdtempSync(join(tmpdir(), "kyuren-install-"));
  const claude = join(root, ".claude");
  const kyuren = join(root, ".kyuren");
  mkdirSync(claude);
  const relay = join(root, "built-kyuren-hook");
  writeFileSync(relay, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  return { claude, kyuren, relay };
}

test("the hook is said as one command, its paths quoted whatever is in them", () => {
  assert.equal(COMMAND, "'/Users/someone/.kyuren/bin/kyuren-hook' claude PermissionRequest --wait 50 --socket '/Users/someone/.kyuren/hooks/kyuren.sock'");
  assert.equal(quoted("/Users/o'brien/x"), "'/Users/o'\\''brien/x'");
});

test("Kyuren's hook is added beside the user's own, and nothing else of theirs is touched", () => {
  const before = theirs();
  const after = withClaudeHook(before, RELAY, SOCKET);
  assert.deepEqual(Object.keys(after), Object.keys(before), "in the same order");
  assert.deepEqual((after.hooks as Record<string, unknown>).PreToolUse, (before.hooks as Record<string, unknown>).PreToolUse);
  assert.deepEqual((after.hooks as Record<string, unknown[]>).PermissionRequest, [
    { hooks: [{ type: "command", command: COMMAND, timeout: 60, statusMessage: "Asking on Kyuren's island" }] },
  ]);
  assert.ok(hasClaudeHook(after, RELAY) && !hasClaudeHook(before, RELAY));
  assert.deepEqual(withClaudeHook(after, RELAY, SOCKET), after, "added once, however often it is asked for");
  assert.deepEqual(before, theirs(), "and the settings given are not changed in place");
});

test("taking it out takes only Kyuren's, leaving theirs where it was", () => {
  const mine = { type: "command", command: "/usr/local/bin/approve" };
  const shared = withClaudeHook({ hooks: { PermissionRequest: [{ matcher: "Bash", hooks: [mine] }] } }, RELAY, SOCKET);
  assert.deepEqual(withoutClaudeHook(shared, RELAY), { hooks: { PermissionRequest: [{ matcher: "Bash", hooks: [mine] }] } });
  assert.deepEqual(withoutClaudeHook(withClaudeHook(theirs(), RELAY, SOCKET), RELAY), theirs(), "back to just as it was");
  const named = { hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "/usr/local/bin/log-kyuren-hook-calls" }] }] } };
  assert.deepEqual(withoutClaudeHook(named, RELAY), named, "a hook of theirs that only mentions the relay is theirs");
  assert.ok(!hasClaudeHook(named, RELAY));
});

test("installed, the settings file keeps its own shape, a copy of it is kept, and the relay is put in place", async () => {
  const { claude, kyuren, relay } = places();
  const file = join(claude, "settings.json");
  writeFileSync(file, `${JSON.stringify(theirs(), null, 4)}\n`, { mode: 0o600 });

  const state = await setClaudeHook({ claudeHome: claude, kyurenHome: kyuren, relay, on: true });
  assert.deepEqual(state, { present: true, on: true });
  const written = readFileSync(file, "utf8");
  assert.ok(written.startsWith('{\n    "effortLevel"'), "four spaces stay four spaces");
  assert.ok(written.endsWith("}\n"));
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.ok(hasClaudeHook(JSON.parse(written), join(kyuren, "bin", "kyuren-hook")));
  const kept = readdirSync(join(kyuren, "backups"));
  assert.equal(kept.length, 1);
  assert.deepEqual(JSON.parse(readFileSync(join(kyuren, "backups", kept[0] ?? ""), "utf8")), theirs());
  assert.equal(statSync(join(kyuren, "bin", "kyuren-hook")).mode & 0o777, 0o755);

  assert.deepEqual(await claudeHookState({ claudeHome: claude, kyurenHome: kyuren }), { present: true, on: true });
  assert.deepEqual(await setClaudeHook({ claudeHome: claude, kyurenHome: kyuren, relay, on: false }), { present: true, on: false });
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), theirs());
});

test("a settings file that cannot be read is left exactly as it is", async () => {
  const { claude, kyuren, relay } = places();
  const file = join(claude, "settings.json");
  writeFileSync(file, '{ "model": "opus", // a comment\n }');
  const state = await setClaudeHook({ claudeHome: claude, kyurenHome: kyuren, relay, on: true });
  assert.equal(state.on, false);
  assert.match(state.trouble ?? "", /could not be read/);
  assert.equal(readFileSync(file, "utf8"), '{ "model": "opus", // a comment\n }');
  assert.ok(!existsSync(join(kyuren, "backups")), "nothing was written, so nothing needed keeping");
});

test("without Claude Code, or without the relay built, nothing is installed", async () => {
  const { claude, kyuren, relay } = places();
  const absent = await setClaudeHook({ claudeHome: join(claude, "missing"), kyurenHome: kyuren, relay, on: true });
  assert.deepEqual(absent, { present: false, on: false, trouble: "Claude Code is not installed for this user." });
  const unbuilt = await setClaudeHook({ claudeHome: claude, kyurenHome: kyuren, relay: join(claude, "nowhere"), on: true });
  assert.match(unbuilt.trouble ?? "", /not built/);
  assert.ok(!existsSync(join(claude, "settings.json")));
});

test("a settings file that is a link is changed where it lives, its permissions exactly as they were", async () => {
  const { claude, kyuren, relay } = places();
  const dotfiles = join(claude, "..", "dotfiles");
  mkdirSync(dotfiles);
  const real = join(dotfiles, "claude-settings.json");
  writeFileSync(real, `${JSON.stringify(theirs(), null, 2)}\n`);
  chmodSync(real, 0o664);
  symlinkSync(real, join(claude, "settings.json"));

  assert.equal((await setClaudeHook({ claudeHome: claude, kyurenHome: kyuren, relay, on: true })).on, true);
  assert.ok(lstatSync(join(claude, "settings.json")).isSymbolicLink(), "still a link");
  assert.equal(statSync(real).mode & 0o777, 0o664);
  assert.ok(hasClaudeHook(JSON.parse(readFileSync(real, "utf8")), join(kyuren, "bin", "kyuren-hook")), "the file it points at has the hook");
  assert.ok(readdirSync(dotfiles).every((name) => name === "claude-settings.json"), "and nothing is left beside it");
});

test("switches flipped together are made one after another, the last one standing", async () => {
  const { claude, kyuren, relay } = places();
  writeFileSync(join(claude, "settings.json"), `${JSON.stringify(theirs(), null, 2)}\n`);
  const states = await Promise.all([true, false, true].map((on) => setClaudeHook({ claudeHome: claude, kyurenHome: kyuren, relay, on })));
  assert.ok(states.every((one) => one.trouble === undefined), JSON.stringify(states));
  assert.deepEqual(await claudeHookState({ claudeHome: claude, kyurenHome: kyuren }), { present: true, on: true });
});
