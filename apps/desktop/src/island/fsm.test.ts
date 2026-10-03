import assert from "node:assert/strict";
import { test } from "node:test";
import { GLANCE, HOLD, INITIAL, KEEP, LATELY, next, OPEN_GRACE, PEEK_GRACE, type Event, type Island } from "./fsm.ts";

function run(events: Array<[number, Event]>, from: Island = INITIAL): Island {
  return events.reduce((state, [at, event]) => next(state, event, at), from);
}

test("a hover on the notch peeks at once, and opens when it is held", () => {
  const peeking = run([[0, { type: "hover", over: true }]]);
  assert.equal(peeking.mode, "peek");
  assert.equal(next(peeking, { type: "tick" }, HOLD - 1).mode, "peek");
  assert.equal(next(peeking, { type: "tick" }, HOLD).mode, "open");
});

test("a peek the cursor leaves folds after a moment, and coming back keeps it", () => {
  let s = run([[0, { type: "hover", over: true }], [100, { type: "hover", over: false }], [110, { type: "tick" }]]);
  assert.equal(s.mode, "peek");
  assert.equal(next(s, { type: "tick" }, 110 + PEEK_GRACE).mode, "hidden");
  s = next(s, { type: "hover", over: true }, 300);
  assert.equal(next(s, { type: "tick" }, 110 + PEEK_GRACE).mode, "peek", "back on it before it folded");
});

test("an open island folds soon after the cursor leaves it", () => {
  let s = run([[0, { type: "hover", over: true }], [HOLD, { type: "tick" }], [2000, { type: "hover", over: false }], [2010, { type: "tick" }]]);
  assert.equal(s.mode, "open");
  s = next(s, { type: "tick" }, 2010 + OPEN_GRACE);
  assert.equal(s.mode, "hidden");
});

test("a click on a peek opens it without waiting", () => {
  const s = run([[0, { type: "hover", over: true }], [100, { type: "click" }]]);
  assert.equal(s.mode, "open");
});

test("summoned, it opens on the voice tab and stays out without the cursor until dismissed", () => {
  let s = run([[0, { type: "summon" }], [10, { type: "tick" }], [5000, { type: "tick" }]]);
  assert.equal(s.mode, "open");
  assert.equal(s.tab, "voice");
  s = run([[6000, { type: "dismiss" }], [6010, { type: "tick" }], [6010 + OPEN_GRACE, { type: "tick" }]], s);
  assert.equal(s.mode, "hidden");
});

test("a permission question opens its tab and holds the island until it is answered", () => {
  let s = run([[0, { type: "alert", id: "q1" }], [10, { type: "tick" }], [60_000, { type: "tick" }]]);
  assert.equal(s.mode, "open");
  assert.equal(s.tab, "permissions");
  s = run([[61_000, { type: "answered", id: "q1" }], [61_010, { type: "tick" }], [61_010 + OPEN_GRACE, { type: "tick" }]], s);
  assert.equal(s.mode, "hidden");
});

test("a notice peeks for a few seconds, and a hover during it opens on the notices", () => {
  let s = run([[0, { type: "notice" }], [10, { type: "tick" }]]);
  assert.equal(s.mode, "peek");
  assert.equal(run([[GLANCE + 10, { type: "tick" }], [GLANCE + 10 + PEEK_GRACE, { type: "tick" }]], s).mode, "hidden");
  s = run([[1000, { type: "hover", over: true }], [1000 + HOLD, { type: "tick" }]], s);
  assert.equal(s.mode, "open");
  assert.equal(s.tab, "notices");
});

test("what holds it out holds it only until the cursor has been to it; leaving then folds it", () => {
  let s = run([[0, { type: "summon" }], [10, { type: "alert", id: "q" }], [5000, { type: "tick" }]]);
  assert.equal(s.mode, "open", "a summons and a question keep it out while the cursor is elsewhere");
  s = run([[6000, { type: "hover", over: true }], [6500, { type: "hover", over: false }], [6510, { type: "tick" }], [6510 + OPEN_GRACE, { type: "tick" }]], s);
  assert.equal(s.mode, "peek", "visited and left, it folds, down to the peek its question keeps");
  assert.equal(s.summoned, true, "the summons is ended by the host, which then says so");
  s = run([[6900, { type: "dismiss" }], [7000, { type: "answered", id: "q" }], [7010, { type: "tick" }], [7010 + PEEK_GRACE, { type: "tick" }]], s);
  assert.equal(s.mode, "hidden");
  s = run([[8000, { type: "alert", id: "r" }], [9000, { type: "tick" }]], s);
  assert.equal(s.mode, "open", "a new question comes out again, as yet unvisited");
});

test("a click elsewhere or another app coming forward folds it at once", () => {
  const s = run([[0, { type: "hover", over: true }], [HOLD, { type: "tick" }], [1000, { type: "away" }]]);
  assert.equal(s.mode, "hidden");
  const summoned = run([[0, { type: "summon" }], [20, { type: "away" }], [30, { type: "tick" }]]);
  assert.equal(summoned.mode, "hidden", "whatever was holding it out");
  assert.equal(summoned.summoned, true, "the host ends the summons and says so");
});

test("escape folds it at once, whatever holds it", () => {
  const s = run([[0, { type: "summon" }], [20, { type: "escape" }]]);
  assert.equal(s.mode, "hidden");
  assert.equal(s.summoned, false);
});

test("a question waiting on the user folds only as far as a peek with its count, until it is answered", () => {
  let s = run([[0, { type: "alert", id: "q1" }]]);
  assert.equal(s.mode, "open");
  s = next(s, { type: "away" }, 100);
  assert.equal(s.mode, "peek", "another app in front folds it, but not out of sight");
  s = run([[200, { type: "tick" }], [200 + PEEK_GRACE + 10, { type: "tick" }]], s);
  assert.equal(s.mode, "peek", "and it stays while the question waits");
  s = run([[2000, { type: "hover", over: true }], [2000 + HOLD, { type: "tick" }]], s);
  assert.deepEqual([s.mode, s.tab], ["open", "permissions"]);
  s = run([[4000, { type: "hover", over: false }], [4010, { type: "tick" }], [4010 + OPEN_GRACE, { type: "tick" }]], s);
  assert.equal(s.mode, "peek", "left unanswered, it is there to come back to");
  assert.equal(next(s, { type: "escape" }, 4500).mode, "peek", "escape too");
  s = run([[5000, { type: "answered", id: "q1" }], [5010, { type: "tick" }], [5010 + PEEK_GRACE, { type: "tick" }]], s);
  assert.equal(s.mode, "hidden", "answered, nothing keeps it out");
});

test("a switched-off tab is never opened, and a question for it is left to the main window", () => {
  const without = run([[0, { type: "tabs", enabled: ["voice", "work", "notices"] }], [10, { type: "alert", id: "q" }]]);
  assert.equal(without.mode, "hidden");
  const quiet = run([[0, { type: "tabs", enabled: ["voice"] }], [10, { type: "notice" }]]);
  assert.equal(quiet.mode, "hidden");
  const moved = run([[0, { type: "pick", tab: "work" }], [10, { type: "tabs", enabled: ["voice", "notices"] }]]);
  assert.equal(moved.tab, "voice", "a tab switched off while showing gives way to one that is on");
});

test("a hover opens on what is waiting first, then what is being worked on, then where it was", () => {
  const working = run([[0, { type: "working", on: true }], [10, { type: "hover", over: true }], [10 + HOLD, { type: "tick" }]]);
  assert.equal(working.tab, "work");
  const last = run([[0, { type: "pick", tab: "notices" }], [10, { type: "hover", over: true }], [10 + HOLD, { type: "tick" }]]);
  assert.equal(last.tab, "notices");
});

test("a chat started puts the icosahedron away, and only the voice hotkey brings it back", () => {
  let s = run([[0, { type: "hover", over: true }], [HOLD, { type: "tick" }]]);
  assert.equal(s.chatting, false, "it opens on the icosahedron");
  s = next(s, { type: "said" }, 1000);
  assert.equal(s.chatting, true);
  s = run([[1100, { type: "hover", over: false }], [1110, { type: "tick" }], [1110 + OPEN_GRACE, { type: "tick" }]], s);
  assert.equal(s.mode, "hidden");
  s = run([[5000, { type: "hover", over: true }], [5000 + HOLD, { type: "tick" }]], s);
  assert.equal(s.mode, "open");
  assert.equal(s.chatting, true, "folding and opening again keeps the conversation");
  s = run([[6000, { type: "pick", tab: "work" }], [6100, { type: "pick", tab: "voice" }], [6200, { type: "escape" }]], s);
  assert.equal(s.chatting, true, "and so do another tab and escape");
  s = run([[7000, { type: "summon" }], [8000, { type: "said" }], [9000, { type: "dismiss" }]], s);
  assert.equal(s.chatting, true, "ending a summons does not bring it back");
  assert.equal(next(s, { type: "summon" }, 10_000).chatting, false, "the voice hotkey does");
});

test("a coding agent newly waiting on the user peeks, and a hover then opens on its tab", () => {
  let s = run([[0, { type: "agents", waiting: 1 }], [10, { type: "tick" }]]);
  assert.equal(s.mode, "peek");
  s = run([[1000, { type: "hover", over: true }], [1000 + HOLD, { type: "tick" }]], s);
  assert.equal(s.mode, "open");
  assert.equal(s.tab, "coding");
  const same = run([[0, { type: "agents", waiting: 1 }], [GLANCE + 1000, { type: "tick" }], [GLANCE + 2000, { type: "tick" }], [GLANCE + 2100, { type: "agents", waiting: 1 }], [GLANCE + 2200, { type: "tick" }]]);
  assert.equal(same.mode, "hidden", "the same one still waiting does not peek again");
  const off = run([[0, { type: "tabs", enabled: ["voice"] }], [10, { type: "agents", waiting: 2 }]]);
  assert.equal(off.mode, "hidden", "with its tab off it does not peek");
});

test("a pomodoro period running out glances from the notch, and a hover opens on the glance", () => {
  let s = run([[0, { type: "tabs", enabled: ["voice", "glance", "notices"] }], [10, { type: "rang" }], [20, { type: "tick" }]]);
  assert.equal(s.mode, "peek");
  s = run([[1000, { type: "hover", over: true }], [1000 + HOLD, { type: "tick" }]], s);
  assert.equal(s.tab, "glance");
  const off = run([[0, { type: "tabs", enabled: ["voice"] }], [10, { type: "rang" }]]);
  assert.equal(off.mode, "hidden", "with no glance showing it stays in the notch");
});

test("a page chosen to open on is where a hover opens, unless something has just glanced out or the user went elsewhere a moment ago", () => {
  let s = run([[0, { type: "home", tab: "glance" }], [10, { type: "pick", tab: "work" }], [20, { type: "hover", over: true }], [20 + HOLD, { type: "tick" }]]);
  assert.equal(s.tab, "glance", "the page chosen, not where it was last");
  const glancing = run([[0, { type: "home", tab: "glance" }], [10, { type: "notice" }], [20, { type: "hover", over: true }], [20 + HOLD, { type: "tick" }]]);
  assert.equal(glancing.tab, "notices", "what glanced out is what a hover opens");
  const off = run([[0, { type: "home", tab: "glance" }], [5, { type: "tabs", enabled: ["voice", "work"] }], [10, { type: "hover", over: true }], [10 + HOLD, { type: "tick" }]]);
  assert.equal(off.tab, "voice", "a page switched off is not opened on");
});

test("tabs are shown in the order chosen", () => {
  const s = run([[0, { type: "tabs", enabled: ["glance", "voice", "bogus" as never, "glance", "coding"] }]]);
  assert.deepEqual(s.enabled, ["glance", "voice", "coding"]);
});

test("something carried onto the notch opens the shelf at once, and folds as a hover does once it leaves", () => {
  let s = run([[0, { type: "hover", over: true }], [10, { type: "drag" }]]);
  assert.equal(s.mode, "open", "without the hover's wait");
  assert.equal(s.tab, "shelf");
  s = run([[20, { type: "pick", tab: "voice" }], [30, { type: "drag" }]], s);
  assert.equal(s.tab, "shelf", "from whichever tab is open");
  s = run([[40, { type: "hover", over: false }], [50, { type: "tick" }], [50 + OPEN_GRACE, { type: "tick" }]], s);
  assert.equal(s.mode, "hidden");
});

test("with the shelf switched off, something carried onto the notch is not taken", () => {
  const off = run([[0, { type: "tabs", enabled: ["voice", "coding"] }], [10, { type: "drag" }]]);
  assert.equal(off.mode, "hidden");
  assert.equal(off.tab, "voice");
});

test("something new on a page opens it next time instead of the page chosen, for five minutes, once", () => {
  let s = run([[0, { type: "home", tab: "glance" }], [10, { type: "lately", tab: "shelf" }]]);
  s = run([[GLANCE + 100, { type: "hover", over: true }], [GLANCE + 100 + HOLD, { type: "tick" }]], s);
  assert.deepEqual([s.mode, s.tab], ["open", "shelf"], "long after any glance, the page something happened on");
  s = run([[10_000, { type: "hover", over: false }], [10_010, { type: "tick" }], [10_010 + OPEN_GRACE, { type: "tick" }]], s);
  s = run([[20_000, { type: "hover", over: true }], [20_000 + HOLD, { type: "tick" }]], s);
  assert.equal(s.tab, "glance", "once seen, the page chosen again");
  const stale = run([[0, { type: "home", tab: "glance" }], [10, { type: "lately", tab: "shelf" }], [LATELY + 20, { type: "hover", over: true }], [LATELY + 20 + HOLD, { type: "tick" }]]);
  assert.equal(stale.tab, "glance", "five minutes on, it is no longer news");
  const off = run([[0, { type: "tabs", enabled: ["voice", "glance"] }], [5, { type: "home", tab: "glance" }], [10, { type: "lately", tab: "shelf" }], [20, { type: "hover", over: true }], [20 + HOLD, { type: "tick" }]]);
  assert.equal(off.tab, "glance", "a page switched off is never news");
});

test("what is new on any page reaches the next open, though a question waiting comes first", () => {
  const later = (events: Array<[number, Event]>) =>
    run([[0, { type: "home", tab: "work" }], ...events, [GLANCE + 100, { type: "hover", over: true }], [GLANCE + 100 + HOLD, { type: "tick" }]]);
  assert.equal(later([[5, { type: "agents", waiting: 1 }]]).tab, "coding");
  assert.equal(later([[5, { type: "notice" }]]).tab, "notices");
  assert.equal(later([[5, { type: "rang" }]]).tab, "glance");
  assert.equal(later([[5, { type: "replied" }]]).tab, "voice", "an answer that came while it was folded");
  const answeredOpen = run([[0, { type: "home", tab: "work" }], [5, { type: "hover", over: true }], [5 + HOLD, { type: "tick" }], [1000, { type: "replied" }]]);
  assert.equal(answeredOpen.lately, null, "an answer seen as it came is not news");

  let s = run([[0, { type: "home", tab: "glance" }], [5, { type: "lately", tab: "shelf" }], [10, { type: "alert", id: "q" }]]);
  assert.equal(s.tab, "permissions");
  s = run([[100, { type: "away" }], [200, { type: "hover", over: true }], [200 + HOLD, { type: "tick" }]], s);
  assert.equal(s.tab, "permissions", "a question waiting is opened on before anything");
  s = run([[1000, { type: "answered", id: "q" }], [1100, { type: "hover", over: false }], [1110, { type: "tick" }], [1110 + OPEN_GRACE, { type: "tick" }]], s);
  s = run([[2000, { type: "hover", over: true }], [2000 + HOLD, { type: "tick" }]], s);
  assert.equal(s.tab, "shelf", "and what was new is still news after it");
});

test("news is spent by visiting its page however it is reached, and an agent that stops waiting is no news", () => {
  let s = run([[0, { type: "home", tab: "glance" }], [5, { type: "hover", over: true }], [5 + HOLD, { type: "tick" }], [1000, { type: "lately", tab: "shelf" }]]);
  s = next(s, { type: "pick", tab: "shelf" }, 1100);
  assert.equal(s.lately, null, "seen by its tab");
  const stopped = run([[0, { type: "home", tab: "glance" }], [5, { type: "agents", waiting: 1 }], [GLANCE + 100, { type: "agents", waiting: 0 }]]);
  assert.equal(stopped.lately, null, "the agent no longer waits, so its page is not news");
  const another = run([[0, { type: "lately", tab: "shelf" }], [5, { type: "agents", waiting: 1 }], [10, { type: "agents", waiting: 0 }]]);
  assert.equal(another.lately, null, "news is one page at a time, and the latest was the agent's");
});

/// Opened by a hover held, then folded by the cursor leaving it, from `at`.
function openedAt(at: number): Array<[number, Event]> {
  return [[at, { type: "hover", over: true }], [at + HOLD, { type: "tick" }]];
}
function foldedAt(at: number): Array<[number, Event]> {
  return [[at, { type: "hover", over: false }], [at + 1, { type: "tick" }], [at + 1 + OPEN_GRACE, { type: "tick" }]];
}

test("a page gone to is where the island opens again for a while after it folds, ahead of the home page and news", () => {
  let s = run([[0, { type: "home", tab: "glance" }], ...openedAt(10), [1000, { type: "pick", tab: "coding" }], ...foldedAt(2000)]);
  assert.equal(s.mode, "hidden");
  s = run([[3000, { type: "lately", tab: "shelf" }], ...openedAt(2000 + KEEP - HOLD - 10)], s);
  assert.equal(s.tab, "coding", "folded by accident, back where it was");
  assert.equal(s.lately?.tab, "shelf", "the news waits for the next open");

  const refold = 2000 + KEEP + 1000;
  const later = run([...foldedAt(refold), ...openedAt(refold + KEEP + 1000)], s);
  assert.equal(later.tab, "shelf", "long after, news and the home page again");
  assert.equal(later.kept, null, "and the place is forgotten");
});

test("a question waiting still comes first, and the place stays for after it", () => {
  let s = run([...openedAt(0), [1000, { type: "pick", tab: "coding" }], ...foldedAt(2000), [3000, { type: "alert", id: "q" }]]);
  assert.equal(s.tab, "permissions");
  assert.equal(s.kept?.tab, "coding");
});

test("going somewhere within a page, or starting a chat, keeps that page too", () => {
  const within = run([[0, { type: "home", tab: "shelf" }], ...openedAt(10), [1000, { type: "pick", tab: "coding" }], [1100, { type: "pick", tab: "glance" }], [1200, { type: "stay" }], ...foldedAt(2000), ...openedAt(3000)]);
  assert.equal(within.tab, "glance", "the page last gone to, not the home page");
  const chat = run([[0, { type: "home", tab: "glance" }], [5, { type: "summon" }], [10, { type: "said" }], [20, { type: "dismiss" }], ...foldedAt(2000), ...openedAt(3000)]);
  assert.equal(chat.tab, "voice", "back to the conversation");
  const idle = run([[0, { type: "stay" }]]);
  assert.equal(idle.kept, null, "nothing is gone to while the island is folded");
});

test("a turn just ended glances out and holds the island a moment, and a hover then opens the coding page", () => {
  const s = run([[0, { type: "home", tab: "glance" }], [10, { type: "done" }]]);
  assert.equal(s.mode, "peek");
  assert.equal(next(s, { type: "tick" }, 10 + GLANCE - 1).mode, "peek", "held out while it is told");
  const hovered = run([[100, { type: "hover", over: true }], [100 + HOLD, { type: "tick" }]], s);
  assert.equal(hovered.tab, "coding");
  const off = run([[0, { type: "tabs", enabled: ["voice", "glance"] }], [10, { type: "done" }]]);
  assert.equal(off.mode, "hidden", "with the coding page switched off, nothing is told");
});

test("a hover while something glances goes toward what glanced, even with a page kept", () => {
  const kept = run([...openedAt(0), [1000, { type: "pick", tab: "shelf" }], ...foldedAt(2000)]);
  const notice = run([[3000, { type: "notice" }], [3100, { type: "hover", over: true }], [3100 + HOLD, { type: "tick" }]], kept);
  assert.equal(notice.tab, "notices");
  const done = run([[3000, { type: "done" }], [3100, { type: "hover", over: true }], [3100 + HOLD, { type: "tick" }]], kept);
  assert.equal(done.tab, "coding");
  const after = run([[3000, { type: "notice" }], [3000 + GLANCE + 10, { type: "tick" }], [3000 + GLANCE + 20, { type: "hover", over: true }], [3000 + GLANCE + 20 + HOLD, { type: "tick" }]], kept);
  assert.equal(after.tab, "shelf", "once the glance is over, the page kept");
});
