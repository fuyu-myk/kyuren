import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { classify, fingerprint, inVault, leaves, type Action } from "#permission/action.ts";

const VAULT = "/Users/someone/kyuren-vault";

/// Kyuren's own vault, which it may write to.
const OWN = [{ path: VAULT, mode: "write" as const }];

function act(over: Partial<Action>): Action {
  return { tool: "write_file", effect: "write", target: `${VAULT}/note.md`, ...over };
}

test("reads pass without asking", () => {
  const action = act({ tool: "read_file", effect: "read", target: "/etc/hosts" });
  assert.equal(classify(action, OWN), "allow");
});

test("a read of what is hidden in the home folder, of its Library, or of a file named as a secret, asks", () => {
  const vault = join(homedir(), ".kyuren/vault");
  const reading = (target: string) => classify({ tool: "read_file", effect: "read", target }, [{ path: vault, mode: "write" }]);
  for (const target of [
    join(homedir(), ".ssh/id_ed25519"),
    join(homedir(), ".SSH/id_ed25519"),
    join(homedir(), "notes/../.aws/credentials"),
    join(homedir(), ".config/gh/hosts.yml"),
    join(homedir(), ".zsh_history"),
    join(homedir(), ".kyuren/events.log"),
    join(homedir(), "Code/app/.git/config"),
    join(homedir(), "Library/Application Support/Slack/storage/root-state.json"),
    `/System/Volumes/Data${join(homedir(), ".claude/settings.json")}`,
    "/Users/someone/code/app/.env",
    "/Users/someone/code/app/.env.local",
    "/Users/someone/code/app/production.env",
    "/Users/someone/Downloads/id_rsa",
    "/Users/someone/Downloads/server.pem",
    "/Users/someone/Downloads/AuthKey_ABC123.p8",
    "/Volumes/Backup/passwords.kdbx",
  ]) {
    assert.equal(reading(target), "ask", target);
  }
  for (const target of [
    join(vault, "today.md"),
    join(homedir(), "Documents/ssh-notes.md"),
    join(homedir(), "Library/Mobile Documents/com~apple~CloudDocs/report.md"),
    join(homedir(), "Library/CloudStorage/Dropbox/plan.md"),
    "/etc/hosts",
    "what did I say about .env files",
  ]) {
    assert.equal(reading(target), "allow", target);
  }
  assert.equal(reading(join(vault, ".obsidian/workspace.json")), "ask", "hidden inside a vault is hidden still");
});

test("a read is judged by the path as written and by the file it opens, whichever is a secret", () => {
  const reading = (target: string, through: string) => classify({ tool: "read_file", effect: "read", target, through }, []);
  assert.equal(reading("/Users/someone/dotfiles/ssh/config", join(homedir(), ".ssh/config")), "ask", "a hidden folder kept elsewhere");
  assert.equal(reading(join(homedir(), ".ssh/id_ed25519"), "/Users/someone/notes.txt"), "ask", "an innocent name for a key");
  assert.equal(reading("/Users/someone/shared/production-settings", "/Users/someone/app/.env"), "ask");
  assert.equal(reading("/Users/someone/notes/today.md", "/Users/someone/today.md"), "allow");
});

test("a vault connected at the home folder does not open what is hidden in it", () => {
  const reading = classify({ tool: "read_file", effect: "read", target: join(homedir(), ".ssh/id_ed25519") }, [{ path: homedir(), mode: "write" }]);
  assert.equal(reading, "ask");
});

test("writes inside the vault pass, writes outside ask", () => {
  assert.equal(classify(act({ target: `${VAULT}/deep/note.md` }), OWN), "allow");
  assert.equal(classify(act({ target: "/Users/someone/.ssh/config" }), OWN), "ask");
});

test("a path that merely starts with the vault name is not inside it", () => {
  assert.equal(classify(act({ target: `${VAULT}-elsewhere/note.md` }), OWN), "ask");
});

test("escaping the vault with a relative path does not pass", () => {
  assert.equal(classify(act({ target: `${VAULT}/../../.ssh/config` }), OWN), "ask");
});

test("running code and reaching the network always ask", () => {
  assert.equal(classify(act({ tool: "shell", effect: "execute", target: "ls" }), OWN), "ask");
  const outbound = act({ tool: "send", effect: "outbound", target: "https://api.example.com/send" });
  assert.equal(classify(outbound, OWN), "ask");
});

test("three classes are refused outright and cannot be approved", () => {
  for (const effect of ["credential", "financial", "destroy"] as const) {
    assert.equal(classify(act({ effect, target: "anything" }), OWN), "deny");
  }
});

test("approving one target does not approve another through the same tool", () => {
  const approved = fingerprint(act({ target: "/Users/someone/notes/today.md" }));
  const other = fingerprint(act({ target: "/Users/someone/.ssh/config" }));
  assert.notEqual(approved, other, "a remembered approval must not generalise across targets");
});

test("approving one effect does not approve another on the same tool and target", () => {
  const read = fingerprint(act({ tool: "files", effect: "read", target: "/tmp/x" }));
  const destroy = fingerprint(act({ tool: "files", effect: "destroy", target: "/tmp/x" }));
  assert.notEqual(read, destroy);
});

test("the same action fingerprints identically however the path is spelled", () => {
  const plain = fingerprint(act({ target: "/Users/someone/notes/today.md" }));
  const winding = fingerprint(act({ target: "/Users/someone/notes/../notes/./today.md" }));
  assert.equal(plain, winding, "otherwise an approval is bypassed by rewriting the path");
});

test("urls fingerprint by origin and path, ignoring case and a trailing slash", () => {
  const a = fingerprint(act({ effect: "outbound", target: "https://API.Example.com/send/" }));
  const b = fingerprint(act({ effect: "outbound", target: "https://api.example.com/send" }));
  assert.equal(a, b);
});

test("an address's query is part of what was approved, so an approval cannot carry anything else there", () => {
  const approved = fingerprint(act({ effect: "outbound", target: "https://example.com/search?q=weather" }));
  const carrying = fingerprint(act({ effect: "outbound", target: "https://example.com/search?q=c2VjcmV0" }));
  assert.notEqual(approved, carrying);
  const marked = fingerprint(act({ effect: "outbound", target: "https://example.com/search?q=weather#results" }));
  assert.equal(approved, marked, "a fragment never leaves the machine");
});

test("different hosts never share an approval", () => {
  const a = fingerprint(act({ effect: "outbound", target: "https://api.example.com/send" }));
  const b = fingerprint(act({ effect: "outbound", target: "https://evil.example.net/send" }));
  assert.notEqual(a, b);
});

const READONLY = [{ path: "/Users/someone/Obsidian", mode: "read" as const }];
const ASKING = [{ path: "/Users/someone/Knowledge", mode: "ask" as const }];

test("a vault marked read only refuses writes rather than asking about them", () => {
  const verdict = classify(act({ target: "/Users/someone/Obsidian/note.md" }), READONLY);
  assert.equal(verdict, "deny", "asking would let one yes turn a read only vault into a writable one");
});

test("a vault that asks, asks", () => {
  assert.equal(classify(act({ target: "/Users/someone/Knowledge/sources.md" }), ASKING), "ask");
});

test("reading a read only vault is still reading", () => {
  const reading = act({ tool: "read_file", effect: "read", target: "/Users/someone/Obsidian/note.md" });
  assert.equal(classify(reading, READONLY), "allow");
});

test("the innermost vault decides, not the one containing it", () => {
  const places = [
    { path: "/Users/someone/Notes", mode: "write" as const },
    { path: "/Users/someone/Notes/Archive", mode: "read" as const },
  ];
  assert.equal(classify(act({ target: "/Users/someone/Notes/today.md" }), places), "allow");
  assert.equal(classify(act({ target: "/Users/someone/Notes/Archive/old.md" }), places), "deny",
    "a read only folder inside a writable one is still read only");
});

test("a relative path cannot climb out of a read only vault into a writable one", () => {
  const places = [
    { path: "/Users/someone/Notes", mode: "write" as const },
    { path: "/Users/someone/Notes/Archive", mode: "read" as const },
  ];
  assert.equal(
    classify(act({ target: "/Users/someone/Notes/Archive/../today.md" }), places),
    "allow",
    "resolving first is what makes the answer about where the write lands",
  );
  assert.equal(
    classify(act({ target: "/Users/someone/Notes/sub/../Archive/old.md" }), places),
    "deny",
  );
});

test("writing somewhere that is no vault at all still asks", () => {
  assert.equal(classify(act({ target: "/Users/someone/Desktop/thing.md" }), READONLY), "ask");
});

const NOTION = [
  { path: "notion://data-source/assignments", mode: "ask" as const },
  { path: "notion://data-source/archive", mode: "read" as const },
];

test("a collection elsewhere is a place like any other", () => {
  const writing = (target: string) => act({ tool: "notion_write", effect: "write", target });

  assert.equal(classify(writing("notion://data-source/assignments/page-1"), NOTION), "ask");
  assert.equal(classify(writing("notion://data-source/archive/page-2"), NOTION), "deny");
  assert.equal(classify(writing("notion://data-source/somewhere-else"), NOTION), "ask",
    "a database that was never connected is not one that may be written to quietly");
});

test("a remote address is not resolved as though it were a path", () => {
  const writing = act({ tool: "notion_write", effect: "write", target: "notion://data-source/assignments/x" });
  assert.equal(classify(writing, NOTION), "ask");
  assert.ok(fingerprint(writing).includes("notion://data-source/assignments/x"),
    "resolving it would rewrite it as a folder under wherever the process happens to be");
});

test("one database's setting does not decide another's", () => {
  const writing = (target: string) => act({ tool: "notion_write", effect: "write", target });
  assert.notEqual(
    classify(writing("notion://data-source/assignments/a"), NOTION),
    classify(writing("notion://data-source/archive/b"), NOTION),
  );
});

test("a database name that merely starts the same is a different database", () => {
  const writing = act({
    tool: "notion_write",
    effect: "write",
    target: "notion://data-source/archive-of-something-else/page",
  });
  assert.equal(classify(writing, NOTION), "ask", "not the read only archive, so not refused as it");
});

test("the home folder is found however its own path is spelled", () => {
  const home = homedir();
  process.env.HOME = `/System/Volumes/Data${home}`;
  try {
    assert.equal(classify({ tool: "read_file", effect: "read", target: join(home, ".ssh/config") }, []), "ask");
  } finally {
    process.env.HOME = home;
  }
});

test("what leaves the machine is what reaches out of it, or is written somewhere that is not on it", () => {
  assert.equal(leaves(act({ tool: "web_search", effect: "outbound", target: "https://html.duckduckgo.com" })), true);
  assert.equal(leaves(act({ tool: "add_to_notion", effect: "write", target: "notion://data-source/tasks/new" })), true);
  assert.equal(leaves(act({ tool: "write_file", effect: "write", target: `${VAULT}/note.md` })), false);
  assert.equal(leaves(act({ tool: "read_file", effect: "read", target: "/etc/hosts" })), false);
});

test("a vault is found however a path into it is spelled, and through a link it was connected by", () => {
  const folder = mkdtempSync(join(tmpdir(), "kyuren-vault-"));
  try {
    mkdirSync(join(folder, "real"));
    symlinkSync(join(folder, "real"), join(folder, "linked"));
    const places = [{ path: join(folder, "linked"), mode: "write" as const }];
    assert.equal(inVault(join(realpathSync(folder), "real/note.md"), places), true, "read by where the link leads");
    assert.equal(inVault(`/System/Volumes/Data${VAULT}/note.md`, [{ path: VAULT, mode: "write" }]), true);
    assert.equal(inVault(`${VAULT.toUpperCase()}/note.md`, [{ path: VAULT, mode: "write" }]), true);
    assert.equal(inVault("/Users/someone/elsewhere/note.md", [{ path: VAULT, mode: "write" }]), false);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("a write is judged where it would land, however it is spelled and whatever link it goes through", () => {
  assert.equal(classify(act({ target: `/System/Volumes/Data${VAULT}/note.md` }), OWN), "allow");
  assert.equal(classify(act({ target: "/System/Volumes/Data/Users/someone/Obsidian/note.md" }), READONLY), "deny");
  assert.equal(classify(act({ target: "/USERS/SOMEONE/OBSIDIAN/note.md" }), READONLY), "deny");
  const folder = mkdtempSync(join(tmpdir(), "kyuren-landing-"));
  try {
    mkdirSync(join(folder, "kept"));
    symlinkSync(join(folder, "kept"), join(folder, "innocent"));
    const kept = [{ path: join(folder, "kept"), mode: "read" as const }];
    assert.equal(classify(act({ target: join(folder, "innocent/new/note.md") }), kept), "deny", "through a link into a read only vault");
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("a write through a link to something not there yet is judged where it would create it", () => {
  const folder = mkdtempSync(join(tmpdir(), "kyuren-dangling-"));
  try {
    mkdirSync(join(folder, "kept"));
    mkdirSync(join(folder, "other"));
    symlinkSync(join(folder, "kept", "missing.md"), join(folder, "other", "d.md"));
    symlinkSync(join(folder, "kept", "missing-folder"), join(folder, "other", "into"));
    const kept = [{ path: join(folder, "kept"), mode: "read" as const }];
    assert.equal(classify(act({ target: join(folder, "other", "d.md") }), kept), "deny");
    assert.equal(classify(act({ target: join(folder, "other", "into", "note.md") }), kept), "deny");
    symlinkSync(join(folder, "other", "loop"), join(folder, "other", "loop"));
    assert.equal(classify(act({ target: join(folder, "other", "loop") }), kept), "ask", "a link to itself is followed no further");
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("a folder Kyuren keeps for itself refuses writes, and changes nothing about reading what is in it", () => {
  const kept = join(homedir(), ".kyuren-kept");
  const places = [{ path: join(kept, "vault"), mode: "write" as const }, { path: kept, mode: "read" as const, own: true as const }];
  const reading = (target: string) => ({ tool: "read_file", effect: "read" as const, target });
  assert.equal(classify(act({ target: join(kept, "answers.json") }), places), "deny");
  assert.equal(classify(act({ target: join(kept, "vault", "days", "note.md") }), places), "allow", "the vault inside it decides for itself");
  assert.equal(classify(reading(join(kept, "answers.json")), places), "ask", "still hidden in the home folder");
  assert.equal(classify(reading(join(kept, "vault", "note.md")), places), "allow");
  assert.equal(inVault(join(kept, "answers.json"), places), false, "none of it is the user's notes");
  assert.equal(inVault(join(kept, "vault", "note.md"), places), true);
});
