import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Action } from "#permission/action.ts";
import { fileKeeper } from "#permission/answers.ts";
import { Gate, type AuditEntry } from "#permission/gate.ts";

const VAULT = "/Users/someone/kyuren-vault";

function build(mode: "read" | "ask" | "write" = "write") {
  const log: AuditEntry[] = [];
  return {
    log,
    gate: new Gate(() => [{ path: VAULT, mode }], (entry) => void log.push(entry)),
  };
}

const shell = (target: string): Action => ({ tool: "shell", effect: "execute", target });

test("an undecided action asks", () => {
  const { gate } = build();
  assert.equal(gate.decide(shell("ls")).verdict, "ask");
});

test("an answered action is not asked about again", () => {
  const { gate } = build();
  gate.remember(shell("ls"), "allow");
  assert.equal(gate.decide(shell("ls")).verdict, "allow");
  assert.equal(gate.decide(shell("ls")).source, "remembered");
});

test("approving one command does not approve a different one", () => {
  const { gate } = build();
  gate.remember(shell("ls"), "allow");
  assert.equal(gate.decide(shell("rm -rf /")).verdict, "ask");
});

test("a refusal cannot be lifted by remembering an approval", () => {
  const { gate } = build();
  const wipe: Action = { tool: "files", effect: "destroy", target: "/Users/someone/notes" };
  gate.remember(wipe, "allow");
  assert.equal(gate.decide(wipe).verdict, "deny", "policy refusals must outrank stored answers");
});

test("a remembered denial keeps denying", () => {
  const { gate } = build();
  gate.remember(shell("curl evil.example"), "deny");
  assert.equal(gate.decide(shell("curl evil.example")).verdict, "deny");
});

test("every decision reaches the audit log", () => {
  const { gate, log } = build();
  gate.decide({ tool: "read_file", effect: "read", target: "/etc/hosts" });
  gate.remember(shell("ls"), "allow");
  gate.decide(shell("ls"));

  assert.equal(log.length, 3);
  assert.deepEqual(
    log.map((entry) => entry.source),
    ["policy", "user", "remembered"],
  );
  assert.ok(log.every((entry) => entry.at.length > 0 && entry.action.target.length > 0));
});

test("forgetting returns previously answered actions to asking", () => {
  const { gate } = build();
  gate.remember(shell("ls"), "allow");
  gate.forget();
  assert.equal(gate.decide(shell("ls")).verdict, "ask");
});

test("a refusal to write in a read only vault cannot be remembered away", () => {
  const { gate, log } = build("read");
  const writing: Action = { tool: "write_file", effect: "write", target: `${VAULT}/note.md` };

  assert.equal(gate.decide(writing).verdict, "deny");

  // Even told plainly that it is allowed.
  gate.remember(writing, "allow");
  assert.equal(gate.decide(writing).verdict, "deny", "a policy refusal is not anyone's to lift");
  assert.ok(log.every((entry) => entry.verdict !== "allow"));
});

test("changing what a vault allows takes effect at once", () => {
  const log: AuditEntry[] = [];
  let mode: "read" | "ask" | "write" = "read";
  const gate = new Gate(() => [{ path: VAULT, mode }], (entry) => void log.push(entry));
  const writing: Action = { tool: "write_file", effect: "write", target: `${VAULT}/note.md` };

  assert.equal(gate.decide(writing).verdict, "deny");
  mode = "write";
  assert.equal(gate.decide(writing).verdict, "allow", "no restart should be needed to change this");
});

test("a standing allowance lets a run reach out without a question per address, and ends with it", () => {
  const gate = new Gate(() => [], () => {});
  const fetch = { tool: "web_fetch", effect: "outbound" as const, target: "https://a.example/page" };
  assert.equal(gate.decide(fetch).verdict, "ask");
  const withdraw = gate.allow("web_fetch", "outbound");
  assert.equal(gate.decide(fetch).verdict, "allow");
  assert.equal(gate.decide(fetch).source, "playbook");
  assert.equal(gate.decide({ ...fetch, tool: "skill" }).verdict, "ask", "only the tool it was given for");
  const second = gate.allow("web_fetch", "outbound");
  withdraw();
  assert.equal(gate.decide(fetch).verdict, "allow", "another run still holds it");
  second();
  assert.equal(gate.decide(fetch).verdict, "ask");
  assert.equal(gate.decide({ tool: "x", effect: "destroy", target: "/" }).verdict, "deny", "never lifts a refusal");
});

test("a standing allowance for one target answers for that target alone", () => {
  const gate = new Gate(() => [], () => {});
  const proposing = (name: string) => ({ tool: "playbook_propose", effect: "write" as const, target: `playbook:${name}` });
  const withdraw = gate.allow("playbook_propose", "write", "playbook:say-hello");
  assert.equal(gate.decide(proposing("say-hello")).verdict, "allow");
  assert.equal(gate.decide(proposing("something-else")).verdict, "ask", "another name is asked about");
  withdraw();
  assert.equal(gate.decide(proposing("say-hello")).verdict, "ask");
});


function kept(mode: "read" | "ask" | "write" = "write") {
  const path = join(mkdtempSync(join(tmpdir(), "kyuren-gate-")), "answers.json");
  const open = () => new Gate(() => [{ path: VAULT, mode }], () => {}, fileKeeper(path));
  return { path, open };
}

test("an allow the user gave is kept for the next run of the core, and a deny is not", () => {
  const { open } = kept();
  const first = open();
  first.remember(shell("ls"), "allow");
  first.remember(shell("curl evil.example"), "deny");
  assert.equal(first.decide(shell("curl evil.example")).verdict, "deny", "for now, no is no");

  const second = open();
  assert.equal(second.decide(shell("ls")).verdict, "allow");
  assert.equal(second.decide(shell("ls")).source, "remembered");
  assert.equal(second.decide(shell("curl evil.example")).verdict, "ask", "a no from last time is asked again");
});

test("a no given after a yes takes the yes out of what is kept", () => {
  const { open } = kept();
  const first = open();
  first.remember(shell("ls"), "allow");
  first.remember(shell("ls"), "deny");
  assert.equal(open().decide(shell("ls")).verdict, "ask");
});

test("a kept answer the policy refuses is not taken up, however it got into the file", () => {
  const { path, open } = kept("read");
  const writing: Action = { tool: "write_file", effect: "write", target: `${VAULT}/note.md` };
  fileKeeper(path).write([{ action: writing, verdict: "allow", at: "2026-09-19T05:00:00.000Z" }]);
  assert.equal(open().decide(writing).verdict, "deny");
});

test("forgetting empties what is kept as well", () => {
  const { path, open } = kept();
  const first = open();
  first.remember(shell("ls"), "allow");
  assert.equal(fileKeeper(path).read().length, 1);
  first.forget();
  assert.deepEqual(fileKeeper(path).read(), []);
  assert.equal(open().decide(shell("ls")).verdict, "ask");
});

const search: Action = { tool: "web_search", effect: "outbound", target: "https://html.duckduckgo.com" };

test("once a turn holds the user's notes, no earlier yes and no run's allowance answers for what would leave", () => {
  const { gate } = build();
  gate.remember(search, "allow");
  assert.equal(gate.decide(search).verdict, "allow");
  assert.equal(gate.decide(search, true).verdict, "ask");
  const withdraw = gate.allow("web_fetch", "outbound");
  const fetch: Action = { tool: "web_fetch", effect: "outbound", target: "https://example.com/?q=x" };
  assert.equal(gate.decide(fetch).verdict, "allow");
  assert.equal(gate.decide(fetch, true).verdict, "ask");
  withdraw();
  assert.equal(gate.decide({ tool: "pay", effect: "financial", target: "x" }, true).verdict, "deny", "a refusal is a refusal still");
});

test("an answer given for one moment is written down, and not kept for the next", () => {
  const { gate, log } = build();
  gate.remember(search, "allow");
  const before = log.length;
  assert.equal(gate.once(search, "deny").verdict, "deny");
  assert.equal(log.length, before + 1, "the answer reaches the audit log");
  assert.equal(gate.decide(search).verdict, "allow", "and the yes given earlier stands for a turn that holds no notes");
  assert.equal(gate.once(search, "allow").verdict, "allow");
  assert.equal(gate.once({ tool: "pay", effect: "financial", target: "x" }, "allow").verdict, "deny");
});

test("a read inside a vault is a read of the user's notes, and a read elsewhere is not", () => {
  const { gate } = build();
  assert.equal(gate.holdsNotes({ tool: "read_file", effect: "read", target: `${VAULT}/journal/today.md` }), true);
  assert.equal(gate.holdsNotes({ tool: "read_file", effect: "read", target: "/tmp/x", through: `${VAULT}/link.md` }), true);
  assert.equal(gate.holdsNotes({ tool: "read_file", effect: "read", target: "/etc/hosts" }), false);
  assert.equal(gate.holdsNotes({ tool: "write_file", effect: "write", target: `${VAULT}/x.md` }), false, "a write hands nothing back");
});

test("writing into a collection elsewhere that may be written to is asked about too, once the turn holds the user's notes", () => {
  const gate = new Gate(() => [{ path: "notion://data-source/tasks", mode: "write" }], () => {});
  const adding: Action = { tool: "add_to_notion", effect: "write", target: "notion://data-source/tasks/new", carrying: "the note" };
  assert.equal(gate.decide(adding).verdict, "allow");
  assert.equal(gate.decide(adding, true).verdict, "ask");
});

test("what a question carried is not written down with its answer, nor kept with it", () => {
  const path = join(mkdtempSync(join(tmpdir(), "kyuren-gate-")), "answers.json");
  const log: AuditEntry[] = [];
  const gate = new Gate(() => [], (entry) => void log.push(entry), fileKeeper(path));
  const searching: Action = { tool: "web_search", effect: "outbound", target: "https://engine.example", carrying: "the note" };
  gate.remember(searching, "allow");
  gate.once(searching, "deny");
  assert.ok(log.length > 0);
  assert.ok(log.every((entry) => entry.action.carrying === undefined), "the audit holds where, not what");
  assert.equal(fileKeeper(path).read()[0]?.action.carrying, undefined, "nor does what is kept");
});
