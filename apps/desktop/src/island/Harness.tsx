import { useState } from "react";
import { emitPreview, type Notch } from "@/island/channels";

const NOTCHED: Notch = { present: true, width: 184, height: 38 };

/// A week to look at, Sunday to Saturday: a day gone by, one event already begun, the next in
/// forty-two minutes, more in the week after, and a calendar not yet allowed.
function sampleWeek(now: number) {
  const today = new Date(now);
  const on = (days: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + days);
  const at = (days: number, hours: number, minutes = 0) => new Date(on(days).setHours(hours, minutes, 0, 0)).toISOString();
  const day = (days: number) => {
    const moment = on(days);
    return `${moment.getFullYear()}-${`${moment.getMonth() + 1}`.padStart(2, "0")}-${`${moment.getDate()}`.padStart(2, "0")}`;
  };
  const timed = (title: string, when: string, collection = "Work") => ({ title, at: when, timed: true, source: "apple_calendar", collection });
  const events: Record<number, Array<ReturnType<typeof timed>>> = {
    [-2]: [timed("Seminar", at(-2, 15))],
    0: [timed("Standup", new Date(now - 60 * 60_000).toISOString()), timed("Design review", new Date(now + 42 * 60_000).toISOString()), timed("Gym", at(0, 18), "Home")],
    1: [timed("Dentist", at(1, 8, 15), "Home")],
    2: [timed("Lecture: graph neural networks", at(2, 10)), timed("Lab", at(2, 14))],
    3: [{ title: "Holiday", at: day(3), timed: false, source: "apple_calendar", collection: "Home" }],
    5: [timed("Brunch with Sam", at(5, 11), "Home")],
    6: [timed("Planning", at(6, 9, 30)), timed("Office hours", at(6, 16))],
  };
  const days = Array.from({ length: 14 }, (_, index) => index - today.getDay()).map((offset) => ({ day: day(offset), events: events[offset] ?? [] }));
  return {
    at: now,
    days: days.slice(0, 7),
    after: days.slice(7),
    read: ["apple_calendar"],
    refused: ["google_calendar"],
    unavailable: [],
    failed: [],
  };
}
/// A day this many days from today, in local time, as the core names days.
function dayFrom(days: number): string {
  const moment = new Date();
  moment.setDate(moment.getDate() + days);
  return `${moment.getFullYear()}-${`${moment.getMonth() + 1}`.padStart(2, "0")}-${`${moment.getDate()}`.padStart(2, "0")}`;
}

const BARE: Notch = { present: false, width: 120, height: 24 };

/// One of each kind of question a coding agent can hold the island with, beside a plain permission.
const PREVIEWED_ASKS = [
  {
    id: "agent-choice",
    harness: "claude",
    session: "s1",
    project: "kyuren",
    tool: "AskUserQuestion",
    kind: "choice",
    questions: [
      { question: "Which store should hold the shelf?", header: "Store", options: [{ label: "SQLite", description: "One file, beside the rest" }, { label: "JSON files", description: "One per item" }], multiSelect: false },
      { question: "Which checks should run first?", header: "Checks", options: [{ label: "Lint", description: "" }, { label: "Unit tests", description: "" }, { label: "End to end", description: "" }], multiSelect: true },
    ],
  },
  {
    id: "agent-plan",
    harness: "claude",
    session: "s1",
    project: "kyuren",
    tool: "ExitPlanMode",
    kind: "plan",
    plan: "## Move the shelf onto SQLite\n\nAs [the shelf's notes](https://example.com/shelf-notes) suggest:\n\n1. Add a table for shelved files, keyed by device and inode.\n2. Read the JSON files once, into it, and keep them as a backup.\n3. Point the shelf's commands at the table.\n4. Test a rename, a move and a file replaced at the same path.",
  },
  {
    id: "agent-edit",
    harness: "claude",
    session: "s1",
    project: "kyuren",
    tool: "Edit",
    kind: "edit",
    path: "apps/desktop/src/island/shelf.ts",
    fresh: false,
    whole: false,
    every: false,
    diff: [
      { kind: "@", text: "change 1" },
      { kind: "-", text: "const LIMIT = 12;" },
      { kind: "+", text: "const LIMIT = 24;" },
      { kind: "+", text: "const KEPT_FOR = 7 * 24 * 3_600_000;" },
    ],
    added: 2,
    removed: 1,
  },
  {
    id: "agent-form",
    harness: "claude",
    session: "s1",
    project: "kyuren",
    tool: "elicitation",
    kind: "form",
    server: "tickets",
    message: "Where should the ticket go?",
    fields: [
      { name: "title", title: "Title", about: "What it is about", type: "string", choices: [], required: true },
      { name: "board", title: "Board", about: "", type: "string", choices: ["Inbox", "Sprint"], required: true },
      { name: "points", title: "Points", about: "", type: "integer", choices: [], required: false, least: 1, most: 13 },
      { name: "urgent", title: "Urgent", about: "", type: "boolean", choices: [], required: false },
    ],
  },
] as const;

/// Outside the app: a desktop to see the island against, the notch drawn over it the way the
/// screen's own notch covers it, and controls for everything the app would send.
export function Harness({ notch }: { notch: Notch }) {
  const [asked, setAsked] = useState(0);
  const voices = ["idle", "listening", "thinking", "speaking"] as const;
  const [voice, setVoice] = useState(0);

  return (
    <>
      {notch.present ? (
        <div className="fake-notch" style={{ width: notch.width, height: notch.height, left: (880 - notch.width) / 2 }} />
      ) : null}
      <div className="harness">
        <button type="button" onClick={() => emitPreview("island:hover", true)}>hover</button>
        <button type="button" onClick={() => emitPreview("island:hover", false)}>leave</button>
        <button type="button" onClick={() => emitPreview("island:summon")}>summon</button>
        <button type="button" onClick={() => emitPreview("island:dismiss")}>dismiss</button>
        <button type="button" onClick={() => emitPreview("island:away")}>click elsewhere</button>
        <button
          type="button"
          onClick={() => {
            const next = (voice + 1) % voices.length;
            setVoice(next);
            emitPreview("orb:state", voices[next]);
          }}
        >
          voice: {voices[voice]}
        </button>
        <button type="button" onClick={() => emitPreview("transcript", { text: "what does my afternoon", final: false })}>hearing</button>
        <button type="button" onClick={() => emitPreview("transcript", { text: "what does my afternoon look like", final: true })}>heard</button>
        <button type="button" onClick={() => emitPreview("agent:text", { id: "voice:1", chunk: "Two things this afternoon: " })}>stream</button>
        <button type="button" onClick={() => emitPreview("agent:reply", "Two things this afternoon: the BIO215 discussion at one, and the signals problem set due at five.")}>reply</button>
        <button
          type="button"
          onClick={() => {
            setAsked(asked + 1);
            emitPreview("permission", { id: `q${asked + 1}`, tool: "web_fetch", effect: "outbound", target: "https://arxiv.org/pdf/2508.10875" });
          }}
        >
          ask permission
        </button>
        <button type="button" onClick={() => emitPreview("permission:answered", `q${asked}`)}>answered</button>
        <button
          type="button"
          onClick={() =>
            emitPreview("agent:permission", {
              id: "agent-1",
              harness: "claude",
              session: "s1",
              project: "kyuren",
              tool: "Bash",
              verb: "run",
              target: "rm -rf apps/desktop/src-tauri/target && cargo build",
              at: Date.now(),
              until: Date.now() + 45_000,
            })
          }
        >
          agent asks
        </button>
        <button type="button" onClick={() => emitPreview("agent:permission-done", { id: "agent-1" })}>agent done</button>
        {PREVIEWED_ASKS.map((ask) => (
          <button
            type="button"
            key={ask.id}
            onClick={() => {
              emitPreview("agent:permission-done", { id: ask.id });
              emitPreview("agent:permission", { ...ask, at: Date.now(), until: Date.now() + 115_000 });
            }}
          >
            agent {ask.kind}
          </button>
        ))}
        <button type="button" onClick={() => emitPreview("presence:notice", {})}>notice</button>
        <button type="button" onClick={() => emitPreview("island:widgets", ["music", "pomodoro", "network", "system", "next"])}>widgets</button>
        <button
          type="button"
          onClick={() => {
            emitPreview("music:now", { player: "spotify", title: "Pastel Rain", artist: "Sangatsu no Phantasia", album: "Girls Blue Happy Sad", duration: 211, position: 41, at: Date.now(), playing: true, track: "spotify:track:x", volume: 64 });
            emitPreview("music:art", { track: "spotify:track:x", art: `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#89b4fa"/><stop offset="1" stop-color="#cba6f7"/></linearGradient></defs><rect width="80" height="80" fill="url(#g)"/></svg>')}` });
          }}
        >
          music
        </button>
        <button type="button" onClick={() => emitPreview("pomodoro:state", { period: "focus", endsAt: Date.now() + 17 * 60_000 + 42_000, left: 0, done: 2 })}>
          pomodoro
        </button>
        <button
          type="button"
          onClick={() => {
            const now = Date.now();
            const traffic = Array.from({ length: 90 }, (_, at) => ({
              at: now - (89 - at) * 1000,
              up: 4_000 + 30_000 * Math.max(0, Math.sin(at / 7)),
              down: 20_000 + 400_000 * Math.max(0, Math.sin(at / 11 + 1)) ** 3,
            }));
            emitPreview("glance:stats", { cpu: 27, gpu: 41, ram: 73, disk: { used: 933e9, total: 995e9 }, traffic });
          }}
        >
          stats
        </button>
        <button type="button" onClick={() => emitPreview("calendar:week", sampleWeek(Date.now()))}>
          week
        </button>
        <button
          type="button"
          onClick={() =>
            emitPreview("todos:changed", {
              database: "Tasks",
              fields: { date: true, priority: true, done: true },
              todos: [
                { id: "0b8c1f2e-1111-4222-8333-000000000001", text: "Reply to the lab about Thursday", due: dayFrom(-1), priority: "High", done: false, url: "https://www.notion.so/one" },
                { id: "0b8c1f2e-1111-4222-8333-000000000002", text: "Book the dentist", due: new Date(Date.now() + 3 * 3_600_000).toISOString(), done: false, url: "https://www.notion.so/two" },
                { id: "0b8c1f2e-1111-4222-8333-000000000003", text: "Read the graph paper", priority: "Low", done: false },
              ],
            })
          }
        >
          todos
        </button>
        <button
          type="button"
          onClick={() =>
            emitPreview("coding:sessions", {
              sessions: [
                { id: "a", harness: "claude", project: "kyuren", title: "island widgets", state: "waiting", waitingFor: "permission prompt", active: Date.now() - 40_000, via: "the desktop app" },
                { id: "b", harness: "codex", project: "Codex", state: "working", active: Date.now() - 300_000 },
                { id: "c", harness: "claude", project: "website", state: "idle", active: Date.now() - 1_200_000, via: "VS Code" },
              ],
            })
          }
        >
          coding
        </button>
        <button
          type="button"
          onClick={() => {
            const icon = (from: string, to: string) =>
              `data:image/svg+xml;base64,${btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><path d="M14 6h26l12 12v40H14z" fill="url(#g)"/></svg>`)}`;
            const now = Date.now();
            emitPreview("shelf:changed", [
              { id: `${now}`, name: "quarterly report for the board.pdf", folder: false, size: 1_234_567, added: now, icon: icon("#f38ba8", "#eba0ac") },
              { id: `${now - 1}`, name: "photos", folder: true, size: 0, added: now - 1, icon: icon("#89b4fa", "#74c7ec") },
              { id: `${now - 2}`, name: "notes.txt", folder: false, size: 812, added: now - 2, icon: icon("#cdd6f4", "#bac2de") },
            ]);
          }}
        >
          shelf
        </button>
        <button
          type="button"
          onClick={() => {
            emitPreview("preview:books", [
              { name: "standup", when: "the morning's notes", approved: true, inputs: [] },
              { name: "research", when: "looking something up", approved: true, inputs: [{ name: "topic", about: "what to look into" }] },
              { name: "trip", when: "planning a trip", approved: true, inputs: [{ name: "city", about: "where" }, { name: "nights", about: "how long" }] },
            ]);
            emitPreview("island:shortcuts", ["standup", "research", "trip"]);
          }}
        >
          shortcuts
        </button>
        <button type="button" onClick={() => emitPreview("preview:carried", { type: "enter", paths: ["/Users/you/Desktop/plan.key"] })}>carry a file</button>
        <button type="button" onClick={() => emitPreview("preview:carried", { type: "leave" })}>carry it away</button>
        <button
          type="button"
          onClick={() => {
            const step = (id: string, verb: string, target: string, ok: boolean | null) => ({ id, verb, target, ok });
            const log = Array.from({ length: 260 }, (_, k) => `   Compiling crate-${k} v0.1.${k}`).join("\n");
            emitPreview("preview:detail", {
              detail: {
                epoch: "preview",
                seq: 9,
                total: 7,
                task: "make the volume control thinner, then look into more detail from agent sessions",
                said: "Both changes are in. Which of the two should I keep: the thin line, or the line with a knob?\n\nI can also make the knob appear only while the volume is being dragged.",
                branch: "main",
                tests: { step: "t5", command: "cargo test 2>&1 | tail -3", passed: 39, failed: 0, ok: true },
                files: [
                  { path: "apps/desktop/src/island/island.css", added: 24, removed: 6, steps: ["t2"] },
                  { path: "apps/desktop/src/island/views/Music.tsx", added: 2, removed: 1, steps: ["t3"] },
                ],
                steps: [
                  step("t1", "read", "apps/desktop/src/island/views/Music.tsx", true),
                  step("t2", "edit", "apps/desktop/src/island/island.css", true),
                  step("t3", "edit", "apps/desktop/src/island/views/Music.tsx", true),
                  step("t4", "hand to an agent", "Review the change", true),
                  step("t5", "run", "cargo test 2>&1 | tail -3", true),
                  step("t6", "run", "pnpm bundle", false),
                  step("t7", "run", "pnpm run:bundle", null),
                ],
              },
              steps: {
                t1: { kind: "read", ok: true, path: "apps/desktop/src/island/views/Music.tsx", from: 66, lines: 3, of: 120, content: ["  return (", '    <div className="widget music">', '      <div className="cover">'], image: false, output: [], earlier: 0 },
                t2: { kind: "edit", ok: true, output: [], earlier: 0, changes: [{ path: "apps/desktop/src/island/island.css", added: 2, removed: 2, diff: [{ kind: "@", text: "@@ -1054,6 +1054,6 @@" }, { kind: " ", text: ".music .volume input::-webkit-slider-runnable-track {" }, { kind: "-", text: "  height: 3px;" }, { kind: "-", text: "  border-radius: 1.5px;" }, { kind: "+", text: "  height: 4px;" }, { kind: "+", text: "  border-radius: 2px;" }] }] },
                t3: { kind: "edit", ok: false, output: ["Error: String to replace not found in file."], earlier: 0, changes: [] },
                t4: { kind: "agent", ok: true, about: "Review the change", prompt: "Review the uncommitted change for correctness and the project's conventions.", agent: "a1", steps: [step("s1", "run", "git diff --stat", true), step("s2", "read", "apps/desktop/src/island/island.css", true)], output: ["No serious issues found."], earlier: 0 },
                s1: { kind: "run", ok: true, command: "git diff --stat", about: "Show the changed files", code: 0, background: false, changes: [], output: [" apps/desktop/src/island/island.css | 8 ++++----", " 1 file changed, 4 insertions(+), 4 deletions(-)"], earlier: 0 },
                t5: { kind: "run", ok: true, command: "cargo test 2>&1 | tail -3", about: "Run the host tests", code: 0, background: false, changes: [], output: ["test result: ok. 39 passed; 0 failed; 0 ignored", "", "test result: ok. 0 passed; 0 failed"], earlier: 0 },
                t6: { kind: "run", ok: false, command: "pnpm bundle > /tmp/bundle.log 2>&1\necho \"exit $?\"\ntail -5 /tmp/bundle.log", about: null, code: 1, background: false, changes: [], output: log.split("\n").slice(-200), earlier: 60 },
                t7: { kind: "run", ok: null, command: "pnpm run:bundle", about: "Build and open the app", code: null, background: false, changes: [], output: [], earlier: 0 },
              },
            });
          }}
        >
          session detail
        </button>
        <button
          type="button"
          onClick={() => emitPreview("coding:done", { session: "a", project: "kyuren", worked: 312_000, outcome: { tests: { passed: 39, failed: 0, ok: true }, files: 3 } })}
        >
          turn done
        </button>
        <button
          type="button"
          onClick={() => emitPreview("coding:done", { session: "c", project: "website", worked: 95_000, outcome: { tests: { passed: 46, failed: 2, ok: false }, files: 1 } })}
        >
          turn failed
        </button>
        <button type="button" onClick={() => emitPreview("mind:step", { id: "run", step: `s${Date.now()}`, tool: "web_search", target: "diffusion language models survey" })}>step</button>
        <button type="button" onClick={() => emitPreview("island:screen", notch.present ? BARE : NOTCHED)}>{notch.present ? "no notch" : "notch"}</button>
      </div>
    </>
  );
}
