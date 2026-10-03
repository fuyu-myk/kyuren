import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { claudeSessions } from "#coding/claude.ts";

const NOW = Date.UTC(2026, 9, 2, 8, 0);

async function registry(files: Record<string, unknown>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kyuren-claude-"));
  for (const [name, body] of Object.entries(files)) {
    await writeFile(join(dir, name), typeof body === "string" ? body : JSON.stringify(body));
  }
  return dir;
}

const base = { sessionId: "s", cwd: "/Users/me/Code/kyuren", procStart: "Fri Oct  2 06:32:31 2026", entrypoint: "claude-desktop", startedAt: NOW - 600_000, statusUpdatedAt: NOW - 1000 };

test("a running session is read from the file it keeps, and its state is said plainly", async () => {
  const dir = await registry({
    "101.json": { ...base, pid: 101, sessionId: "a", status: "busy", name: "island rework" },
    "102.json": { ...base, pid: 102, sessionId: "b", status: "waiting", waitingFor: "permission prompt", entrypoint: "claude-vscode" },
    "103.json": { ...base, pid: 103, sessionId: "c", status: "idle" },
  });
  const sessions = await claudeSessions(dir, async () => true);
  const byId = new Map(sessions.map((one) => [one.id, one]));

  assert.deepEqual(
    { state: byId.get("a")?.state, project: byId.get("a")?.project, title: byId.get("a")?.title, via: byId.get("a")?.via },
    { state: "working", project: "kyuren", title: "island rework", via: "the desktop app" },
  );
  assert.deepEqual({ state: byId.get("b")?.state, waitingFor: byId.get("b")?.waitingFor, via: byId.get("b")?.via }, { state: "waiting", waitingFor: "permission prompt", via: "VS Code" });
  assert.equal(byId.get("c")?.state, "idle");
  assert.ok(sessions.every((one) => one.harness === "claude"));
  assert.deepEqual(sessions.map((one) => one.pid).sort(), [101, 102, 103], "each with its process, to find the app it runs in");
});

test("a session whose process is gone, or is another process now, is not running", async () => {
  const dir = await registry({
    "201.json": { ...base, pid: 201, sessionId: "gone", status: "busy" },
    "202.json": { ...base, pid: 202, sessionId: "here", status: "busy" },
  });
  const sessions = await claudeSessions(dir, async (pid) => pid === 202);
  assert.deepEqual(sessions.map((one) => one.id), ["here"]);
});

test("what is not a session file, or not one that can be read, is passed over", async () => {
  const dir = await registry({
    "2026-03-31-kyuren-graph-session.tmp": "notes",
    "301.json": "{ not json",
    "302.json": { pid: 302 },
    "303.json": { ...base, pid: 303, sessionId: "fine", status: "busy" },
  });
  const sessions = await claudeSessions(dir, async () => true);
  assert.deepEqual(sessions.map((one) => one.id), ["fine"]);
});

test("every session still open is shown, however long it has been idle, and a missing folder is no sessions", async () => {
  const dir = await registry({
    "401.json": { ...base, pid: 401, sessionId: "old", status: "idle", statusUpdatedAt: NOW - 3 * 3_600_000 },
    "402.json": { ...base, pid: 402, sessionId: "busy-for-long", status: "busy", statusUpdatedAt: NOW - 3 * 3_600_000 },
  });
  const sessions = await claudeSessions(dir, async () => true);
  assert.deepEqual(sessions.map((one) => [one.id, one.state]).sort(), [["busy-for-long", "working"], ["old", "idle"]]);
  assert.deepEqual(await claudeSessions(join(dir, "nowhere"), async () => true), []);
});

test("a background command still running is work, and the harness's own helpers are not sessions", async () => {
  const dir = await registry({
    "601.json": { ...base, pid: 601, sessionId: "dev-server", status: "shell", kind: "interactive" },
    "602.json": { ...base, pid: 602, sessionId: "helper", status: "busy", kind: "daemon" },
    "603.json": { ...base, pid: 603, sessionId: "pooled", status: "idle", kind: "spare" },
    "604.json": { ...base, pid: 604, sessionId: "background", status: "busy", kind: "bg" },
  });
  const sessions = await claudeSessions(dir, async () => true);
  assert.deepEqual(sessions.map((one) => [one.id, one.state]).sort(), [["background", "working"], ["dev-server", "working"]]);
});
