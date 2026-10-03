import assert from "node:assert/strict";
import { test } from "node:test";
import { fromActivity, IDLE_FOR, WORKING_FOR, type Trail } from "#coding/activity.ts";
import { trailsIn } from "#coding/watch.ts";

const NOW = Date.UTC(2026, 9, 2, 8, 0);
const codex: Trail = { harness: "codex", root: "/h/.codex/sessions", depth: 3, file: /^rollout-.*\.jsonl$/ };

test("a session file written to just now is working, a while ago idle, long ago not shown", () => {
  const recent = new Map([
    ["/h/.codex/sessions/2026/10/02/rollout-a.jsonl", NOW - 2_000],
    ["/h/.codex/sessions/2026/10/02/rollout-b.jsonl", NOW - WORKING_FOR - 5_000],
    ["/h/.codex/sessions/2026/10/01/rollout-c.jsonl", NOW - IDLE_FOR - 5_000],
    ["/h/.codex/sessions/2026/10/02/notes.txt", NOW],
    ["/h/.codex/sessions/rollout-shallow.jsonl", NOW],
  ]);
  const sessions = fromActivity([codex], recent, NOW, new Map());
  assert.deepEqual(sessions.map((one) => [one.id, one.state]), [["rollout-a", "working"], ["rollout-b", "idle"]]);
  assert.ok(sessions.every((one) => one.harness === "codex" && one.project === "Codex"));
});

test("a session a better source already knows is not counted twice", () => {
  const claude: Trail = { harness: "claude", root: "/h/.claude/projects", depth: 1, file: /\.jsonl$/ };
  const recent = new Map([["/h/.claude/projects/-h-Code-kyuren/abc.jsonl", NOW - 1_000]]);
  const projects = new Map([["/h/.claude/projects/-h-Code-kyuren", "/h/Code/kyuren"]]);
  assert.deepEqual(fromActivity([claude], recent, NOW, projects, new Set(["abc"])), []);
  const shown = fromActivity([claude], recent, NOW, projects);
  assert.deepEqual(shown.map((one) => [one.id, one.project]), [["abc", "kyuren"]], "and otherwise it is named for its project");
});

test("each harness's files are told apart where they lie", () => {
  const trails = trailsIn("/h");
  const recent = new Map([
    ["/h/.gemini/tmp/abc/chats/session-1.jsonl", NOW - 1_000],
    ["/h/.gemini/antigravity/conversations/conv-1.pb", NOW - 1_000],
    ["/h/.pi/agent/sessions/--h-Code-kyuren--/s.jsonl", NOW - 1_000],
  ]);
  const shown = fromActivity(trails, recent, NOW, new Map([["/h/.pi/agent/sessions/--h-Code-kyuren--", "/h/Code/kyuren"]]));
  assert.deepEqual(shown.map((one) => [one.harness, one.project]), [["gemini", "Gemini"], ["antigravity", "Antigravity"], ["pi", "kyuren"]]);
});

test("a trail that only stands in for a better record shows work while it is written, and nothing after", () => {
  const claude: Trail = { harness: "claude", root: "/h/.claude/projects", depth: 1, file: /\.jsonl$/, lingers: false };
  const recent = new Map([
    ["/h/.claude/projects/-h-a/written-now.jsonl", NOW - 2_000],
    ["/h/.claude/projects/-h-a/finished.jsonl", NOW - WORKING_FOR - 5_000],
  ]);
  assert.deepEqual(fromActivity([claude], recent, NOW, new Map()).map((one) => [one.id, one.state]), [["written-now", "working"]]);
});
