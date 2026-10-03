/// What the island is doing, as a state machine with no clock or screen of its own: every event
/// arrives with the time it happened, so the rules can be tested without waiting for them.

export type Mode = "hidden" | "peek" | "open";

export const TABS = ["voice", "glance", "shortcuts", "shelf", "permissions", "work", "coding", "notices"] as const;
export type Tab = (typeof TABS)[number];

export type Island = {
  mode: Mode;
  tab: Tab;
  hovered: boolean;
  /// Summoned by the hotkey or by name, and listening until dismissed.
  summoned: boolean;
  /// Permission questions waiting for an answer.
  alerts: string[];
  /// The cursor has been on the island since it last came out, so leaving it folds it.
  visited: boolean;
  /// Until when a notice holds the island out.
  noticeUntil: number;
  /// When a hover held on a peek opens it.
  openAt: number | null;
  /// When an island nothing holds out folds.
  foldAt: number | null;
  /// Something is being worked on, which makes its tab the one a hover opens.
  working: boolean;
  /// Coding agents on this Mac waiting on the user, for a permission or an answer.
  agentsWaiting: number;
  /// Until when a pomodoro period just run out makes the glance the tab a hover opens.
  rangUntil: number;
  /// Until when a coding session's turn just ended holds the island out, telling how it went.
  doneUntil: number;
  /// The page chosen to open on whenever the notch is expanded, or none for what needs the user.
  home: Tab | null;
  /// A page something new happened on, which the next open is for until this time.
  lately: { tab: Tab; until: number } | null;
  /// The page the user last went to, by its tab or within it, which the island opens on again for
  /// a while after it folds, so a fold by accident costs nothing. Kept with no end while the
  /// island is open on it.
  kept: { tab: Tab; until: number | null } | null;
  /// A chat has started on the voice tab, so it shows the conversation rather than the
  /// icosahedron, until the voice hotkey or the name brings the icosahedron back.
  chatting: boolean;
  enabled: readonly Tab[];
};

/// A hover on the notch held this long opens the island.
export const HOLD = 650;
/// A peek the cursor has left folds after this, an open island sooner.
export const PEEK_GRACE = 600;
export const OPEN_GRACE = 250;
/// A notice holds the island out this long.
export const GLANCE = 5000;
/// Something new on a page is what the next open shows for this long, then no longer news.
export const LATELY = 5 * 60_000;
/// The page gone to is where the island opens again for this long after it folds.
export const KEEP = 2 * 60_000;

export type Event =
  | { type: "hover"; over: boolean }
  | { type: "tick" }
  | { type: "click" }
  | { type: "summon" }
  | { type: "dismiss" }
  | { type: "alert"; id: string }
  | { type: "answered"; id: string }
  | { type: "notice" }
  | { type: "escape" }
  | { type: "away" }
  | { type: "drag" }
  | { type: "lately"; tab: Tab }
  | { type: "replied" }
  | { type: "pick"; tab: Tab }
  /// The user went somewhere within the page the island is open on.
  | { type: "stay" }
  | { type: "working"; on: boolean }
  | { type: "agents"; waiting: number }
  | { type: "rang" }
  | { type: "done" }
  | { type: "home"; tab: Tab | null }
  | { type: "said" }
  | { type: "tabs"; enabled: readonly Tab[] };

export const INITIAL: Island = {
  mode: "hidden",
  tab: "voice",
  hovered: false,
  summoned: false,
  alerts: [],
  visited: false,
  noticeUntil: 0,
  openAt: null,
  foldAt: null,
  working: false,
  agentsWaiting: 0,
  rangUntil: 0,
  doneUntil: 0,
  home: null,
  lately: null,
  kept: null,
  chatting: false,
  enabled: TABS,
};

/// Whether something other than the cursor keeps the island out. It does so only until the
/// cursor has been to the island; after that, leaving it folds it whatever is held.
export function held(s: Island, now: number): boolean {
  return s.summoned || s.alerts.length > 0 || s.noticeUntil > now || s.doneUntil > now;
}

function usable(s: Island, tab: Tab): boolean {
  return s.enabled.includes(tab);
}

function keeping(s: Island, now: number): boolean {
  return s.kept !== null && (s.kept.until === null || s.kept.until > now);
}

/// The tab an island opens on: a question waiting on you first; while something glances out of the
/// notch, what glanced, since a hover then is a hover toward it; then the page the user went to
/// before it folded a moment ago, then the page something new happened on lately, then the page
/// chosen to open on, then what is waiting, was just noticed or is being worked on, then wherever
/// it was last.
export function preferred(s: Island, now: number): Tab {
  const order: Tab[] = [];
  const glancing = s.noticeUntil > now || s.doneUntil > now;
  if (s.alerts.length > 0) order.push("permissions");
  if (glancing && s.lately && s.lately.until > now) order.push(s.lately.tab);
  if (s.kept && keeping(s, now)) order.push(s.kept.tab);
  if (s.lately && s.lately.until > now) order.push(s.lately.tab);
  // The page chosen is passed over only while something has just glanced out of the notch: a
  // hover then is a hover toward what glanced.
  if (s.home && s.noticeUntil <= now) order.push(s.home);
  if (s.agentsWaiting > 0) order.push("coding");
  if (s.rangUntil > now) order.push("glance");
  if (s.noticeUntil > now) order.push("notices");
  if (s.working) order.push("work");
  order.push(s.tab, ...TABS);
  return order.find((tab) => usable(s, tab)) ?? s.tab;
}

/// Opened on a page that was news, it is news no longer. Opened on the page kept, it is kept for as
/// long as the island stays open; a place kept too long ago is forgotten.
function opened(s: Island, tab: Tab, now: number): Island {
  const kept = s.kept && keeping(s, now) ? (s.kept.tab === tab ? { tab, until: null } : s.kept) : null;
  return { ...s, mode: "open", tab, openAt: null, foldAt: null, lately: s.lately?.tab === tab ? null : s.lately, kept };
}

/// Something new on a page, which the next open is for.
function news(s: Island, tab: Tab, now: number): Island {
  return usable(s, tab) ? { ...s, lately: { tab, until: now + LATELY } } : s;
}

/// Folded away; or, while a question waits on the user, only as far as a peek with its count, since
/// whatever asked is stopped until it is answered and must not be out of sight.
function folded(s: Island, now: number): Island {
  const kept = s.kept && s.kept.until === null ? { tab: s.kept.tab, until: now + KEEP } : s.kept;
  return { ...s, mode: s.alerts.length > 0 ? "peek" : "hidden", visited: false, openAt: null, foldAt: null, kept };
}

export function next(s: Island, e: Event, now: number): Island {
  switch (e.type) {
    case "hover": {
      if (e.over) {
        if (s.mode === "hidden") return { ...s, hovered: true, visited: true, mode: "peek", openAt: now + HOLD, foldAt: null };
        if (s.mode === "peek") return { ...s, hovered: true, visited: true, openAt: s.openAt ?? now + HOLD, foldAt: null };
        return { ...s, hovered: true, visited: true, foldAt: null };
      }
      return { ...s, hovered: false, openAt: null };
    }

    case "tick": {
      if (s.mode === "peek" && s.hovered && s.openAt !== null && now >= s.openAt) {
        return opened(s, preferred(s, now), now);
      }
      if (s.mode === "hidden" || s.hovered || (held(s, now) && !s.visited)) {
        return s.foldAt === null ? s : { ...s, foldAt: null };
      }
      if (s.foldAt === null) return { ...s, foldAt: now + (s.mode === "peek" ? PEEK_GRACE : OPEN_GRACE) };
      return now >= s.foldAt ? folded(s, now) : s;
    }

    case "click":
      return s.mode === "peek" ? opened(s, preferred(s, now), now) : s;

    case "summon":
      return opened({ ...s, summoned: true, chatting: false }, usable(s, "voice") ? "voice" : preferred(s, now), now);

    case "dismiss":
      return { ...s, summoned: false };

    case "alert": {
      const alerts = s.alerts.includes(e.id) ? s.alerts : [...s.alerts, e.id];
      // With its tab switched off, a question is left to the main window and does not open this.
      if (!usable(s, "permissions")) return s;
      return opened({ ...s, alerts }, "permissions", now);
    }

    case "answered":
      return { ...s, alerts: s.alerts.filter((id) => id !== e.id) };

    case "notice": {
      if (!usable(s, "notices")) return s;
      const glancing = { ...news(s, "notices", now), noticeUntil: now + GLANCE };
      return s.mode === "hidden" ? { ...glancing, mode: "peek", openAt: s.hovered ? now + HOLD : null } : glancing;
    }

    case "escape":
      return { ...folded(s, now), summoned: false, noticeUntil: 0 };

    // A click elsewhere or another app in front. A summons is ended by the host, which says so.
    case "away":
      return { ...folded(s, now), noticeUntil: 0 };

    // Something carried onto the notch is for the shelf: it opens there without the hover's wait,
    // and the cursor carrying it is on the island.
    case "drag":
      return usable(s, "shelf") ? { ...opened(s, "shelf", now), hovered: true, visited: true } : s;

    // A page reached by its tab is seen, so it is news no longer, and is where the user went.
    case "pick":
      if (!usable(s, e.tab)) return s;
      return { ...s, tab: e.tab, lately: s.lately?.tab === e.tab ? null : s.lately, kept: s.mode === "open" ? { tab: e.tab, until: null } : s.kept };

    case "stay":
      return s.mode === "open" ? { ...s, kept: { tab: s.tab, until: null } } : s;

    case "working":
      return { ...s, working: e.on };

    // One more agent waiting glances out of the notch, the way a notice does; the same ones still
    // waiting do not, or the island would never stay folded.
    case "agents": {
      const counted = { ...s, agentsWaiting: e.waiting, lately: e.waiting === 0 && s.lately?.tab === "coding" ? null : s.lately };
      if (e.waiting <= s.agentsWaiting || !usable(s, "coding")) return counted;
      const glancing = { ...news(counted, "coding", now), noticeUntil: now + GLANCE };
      return s.mode === "hidden" ? { ...glancing, mode: "peek", openAt: s.hovered ? now + HOLD : null } : glancing;
    }

    // A conversation started is somewhere to come back to.
    case "said":
      return { ...s, chatting: true, kept: { tab: "voice", until: null } };

    case "rang": {
      if (!usable(s, "glance")) return s;
      const glancing = { ...news(s, "glance", now), noticeUntil: now + GLANCE, rangUntil: now + GLANCE };
      return s.mode === "hidden" ? { ...glancing, mode: "peek", openAt: s.hovered ? now + HOLD : null } : glancing;
    }

    // A coding session's turn ended after working a while: it glances out the way a notice does,
    // telling how it went, and the coding page is what the next open is for.
    case "done": {
      if (!usable(s, "coding")) return s;
      const glancing = { ...news(s, "coding", now), doneUntil: now + GLANCE };
      return s.mode === "hidden" ? { ...glancing, mode: "peek", openAt: s.hovered ? now + HOLD : null } : glancing;
    }

    case "home":
      return { ...s, home: e.tab };

    case "lately":
      return news(s, e.tab, now);

    // An answer that came while the island was folded is for the next open; one seen as it came is not.
    case "replied":
      return s.mode === "hidden" ? news(s, "voice", now) : s;

    case "tabs": {
      const enabled = e.enabled.filter((tab, at) => (TABS as readonly string[]).includes(tab) && e.enabled.indexOf(tab) === at);
      const narrowed = { ...s, enabled };
      return usable(narrowed, s.tab) ? narrowed : { ...narrowed, tab: preferred(narrowed, now) };
    }
  }
}
