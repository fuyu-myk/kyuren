import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { resolvePermission, type PermissionRequest } from "@/agent";
import type { Firing } from "@/ambient";
import { command, insideTauri, on, onCarried, type Notch, type Voice as Speaking } from "@/island/channels";
import { drawFace } from "@/island/drawFace";
import { atRest, FACE, stepFace } from "@/island/face";
import { INITIAL, next, TABS, type Event, type Island as State, type Mode, type Tab } from "@/island/fsm";
import type { Clock, Playing, Snapshot } from "@/island/glance";
import { waitingBesides, type AgentAsk, type Decision } from "@/island/asks";
import { toldOf, type Finished } from "@/island/done";
import { Harness } from "@/island/Harness";
import { TabIcon, TITLES } from "@/island/icons";
import { current, grown, moved, settled, still, type Size } from "@/island/motion";
import { placeOf } from "@/island/place";
import { footprint, outlineAt, outlinePath } from "@/island/shape";
import type { Shelved } from "@/island/shelf";
import { EMPTY, said } from "@/island/thread";
import { Coding, type Session } from "@/island/views/Coding";
import { merged, type Detail, type StepDetail } from "@/island/steps";
import { CodingDetail, type LoadStep } from "@/island/views/CodingDetail";
import { Glance } from "@/island/views/Glance";
import { Notices } from "@/island/views/Notices";
import { Permissions } from "@/island/views/Permissions";
import { Shelf } from "@/island/views/Shelf";
import { Shortcuts, type Ran } from "@/island/views/Shortcuts";
import { chosen, type Book } from "@/island/shortcuts";
import { Voice } from "@/island/views/Voice";
import { Work, type Step } from "@/island/views/Work";
import { stillWorth } from "@/news";
import type { Invoked, Listed } from "@/playbook";
import { ask } from "@/asking";

/// The panel the island lives in, which the host keeps at the top centre of the screen.
const PANEL_WIDTH = 880;
const PANEL_HEIGHT = 320;
/// How far a peek reaches out either side of the notch, and how far while it tells how a coding
/// session's turn went, with room for a line on each side.
const SIDE = 52;
const WING = 190;
const OPEN_WIDTH = 800;
const OPEN_HEIGHT = 236;
/// The composer's row at the foot of the voice tab; the icosahedron stands centred above it.
const FOOT = 46;
/// The icosahedron's radius before it swells: large enough that the frame reads as one.
const FACE_SIZE = 34;
/// A step not finished within this long is no longer taken as work in progress.
const STALE = 120_000;

const GUESS: Notch = { present: true, width: 184, height: 38 };

function target(mode: Mode, notch: Notch, telling = false): Size {
  if (mode === "open") return { width: OPEN_WIDTH, height: OPEN_HEIGHT, radius: 24, ear: 12 };
  if (mode === "peek") return { width: notch.width + 2 * (telling ? WING : SIDE), height: notch.height, radius: Math.min(14, notch.height / 2), ear: 8 };
  return { width: notch.width, height: notch.height, radius: Math.min(10, notch.height / 2), ear: 0 };
}

function faceAt(notch: Notch): { x: number; y: number } {
  const top = notch.height + 8;
  const height = OPEN_HEIGHT - notch.height - 20;
  return { x: PANEL_WIDTH / 2, y: top + (height - FOOT) / 2 };
}

type Action = { event: Event; at: number };

function reduce(s: State, a: Action): State {
  return next(s, a.event, a.at);
}

export function Island() {
  const [state, send] = useReducer(reduce, INITIAL);
  const dispatch = useCallback((event: Event) => send({ event, at: performance.now() }), []);
  const [thread, tell] = useReducer(said, EMPTY);
  const [notch, setNotch] = useState<Notch>(GUESS);
  const [voice, setVoice] = useState<Speaking>("idle");
  const [route, setRoute] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [alerts, setAlerts] = useState<PermissionRequest[]>([]);
  const [asks, setAsks] = useState<AgentAsk[]>([]);
  const [askNote, setAskNote] = useState<string | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [notices, setNotices] = useState<Firing[]>([]);
  const [pending, setPending] = useState(0);
  const [coding, setCoding] = useState<Session[]>([]);
  /// The last turn told of, and every session's last finished turn, which its row shows a while.
  const [told, setTold] = useState<Finished | null>(null);
  const [finished, setFinished] = useState<Record<string, Finished & { at: number }>>({});
  /// The coding session opened from the list, and what it is doing.
  const [watching, setWatching] = useState<Session | null>(null);
  const [detail, setDetail] = useState<Detail | null | undefined>(undefined);
  /// The tabs as set, and the widgets the glance holds: the glance is a tab only with one on.
  const [tabsSet, setTabsSet] = useState<Tab[] | null>(null);
  const [widgets, setWidgets] = useState<string[]>([]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [clock, setClock] = useState<Clock>({ period: "focus", endsAt: null, left: 25 * 60_000, done: 0 });
  const [playing, setPlaying] = useState<Playing | null>(null);
  const [art, setArt] = useState<{ track: string; art: string } | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [shelf, setShelf] = useState<Shelved[]>([]);
  const [carrying, setCarrying] = useState(false);
  const [keeping, setKeeping] = useState(false);
  const [shelfTrouble, setShelfTrouble] = useState<string | null>(null);
  /// The playbooks chosen as shortcuts, the books as the core lists them, and the last run.
  const [shortcuts, setShortcuts] = useState<string[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  const [runningShortcut, setRunningShortcut] = useState<string | null>(null);
  const [ran, setRan] = useState<Ran | null>(null);
  const [runTrouble, setRunTrouble] = useState<string | null>(null);
  /// The mode the island has grown into, which is when what belongs inside it may show.
  const [ready, setReady] = useState<Mode | null>(null);

  const now = useRef({ state, notch, voice, asking, thread });
  now.current = { state, notch, voice, asking, thread };

  const body = useRef<HTMLDivElement>(null);
  const fill = useRef<SVGPathElement>(null);
  const band = useRef<SVGPathElement>(null);
  const edge = useRef<SVGPathElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const motion = useRef(still(target("hidden", GUESS)));
  const face = useRef(FACE);
  const grownInto = useRef<Mode | null>(null);
  const sent = useRef({ x: 0, y: 0, width: 0, height: 0 });
  const energy = useRef(0);
  const running = useRef(false);
  /// Counts the times a summons started the conversation over, so an answer to a question typed
  /// before one lands nowhere rather than in the conversation that replaced it.
  const era = useRef(0);

  // One loop for the shape and the icosahedron. It runs while either is moving or shown, and
  // stops when the island is still and the icosahedron put away, so a resting island costs nothing.
  const wake = useCallback(() => {
    if (running.current) return;
    running.current = true;
    let last = performance.now();
    const frame = (at: number) => {
      const dt = Math.min(0.05, (at - last) / 1000);
      last = at;
      const { state: s, notch: n, voice: v } = now.current;
      const to = target(s.mode, n, s.doneUntil > performance.now());
      motion.current = moved(motion.current, to, dt);
      const size = current(motion.current);
      const outline = outlineAt(PANEL_WIDTH, size.width, size.height, size.radius, size.ear);
      const closed = outlinePath(outline, true);
      const open = outlinePath(outline, false);
      fill.current?.setAttribute("d", closed);
      band.current?.setAttribute("d", closed);
      edge.current?.setAttribute("d", open);
      const resting = settled(motion.current, to);
      const shown = s.mode !== "hidden" || !resting;
      if (body.current) body.current.style.opacity = shown ? "1" : "0";

      // What goes inside waits until the island has grown around it, and leaves the moment it
      // starts to become something else.
      const into = s.mode !== "hidden" && (grownInto.current === s.mode || grown(motion.current, to)) ? s.mode : null;
      if (into !== grownInto.current) {
        grownInto.current = into;
        setReady(into);
      }

      const area = shown ? footprint(outline) : { x: 0, y: 0, width: 0, height: 0 };
      const was = sent.current;
      if (Math.abs(area.x - was.x) > 0.5 || Math.abs(area.width - was.width) > 0.5 || Math.abs(area.height - was.height) > 0.5) {
        sent.current = area;
        void command("island_rect", area);
      }

      const place = placeOf({ open: s.mode === "open", ready: into === "open", tab: s.tab, chatting: s.chatting });
      face.current = stepFace(face.current, place, v, energy.current, dt);
      if (canvas.current) drawFace(canvas.current, face.current, faceAt(n), FACE_SIZE, closed);

      if (resting && atRest(face.current)) {
        running.current = false;
        return;
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }, []);

  useEffect(() => {
    wake();
  }, [wake, state.mode, notch, voice, state.tab, state.chatting, state.doneUntil]);

  // A turn's end is told for as long as it holds the island out, and then the line goes and the
  // peek draws back in, whatever else still holds it.
  const [telling, setTelling] = useState(false);
  useEffect(() => {
    const left = state.doneUntil - performance.now();
    if (left <= 0) return;
    setTelling(true);
    const over = setTimeout(() => {
      setTelling(false);
      wake();
    }, left);
    return () => clearTimeout(over);
  }, [state.doneUntil, wake]);

  useEffect(() => {
    void command("island_mode", { shown: state.mode !== "hidden" });
  }, [state.mode]);

  // Folded, to a peek or away, it gives the keyboard back, and a summons ends with it: the
  // microphone is never left open with nothing on screen to say so.
  useEffect(() => {
    if (state.mode === "open") return;
    (document.activeElement as HTMLElement | null)?.blur();
    void command("island_focus", { on: false });
    if (state.summoned) void command("island_dismiss");
  }, [state.mode, state.summoned]);

  useEffect(() => {
    const ticking = setInterval(() => dispatch({ type: "tick" }), 100);
    return () => clearInterval(ticking);
  }, [dispatch]);

  const refreshNotices = useCallback(async () => {
    try {
      const recent = (await command<Firing[]>("ambient_recent", { limit: 12 })) ?? [];
      setNotices(recent.filter((one) => stillWorth(one, Date.now())));
    } catch {
      setNotices([]);
    }
  }, []);

  // The host copies in what the window says was dropped, which may take a while for a folder from
  // another volume; with the shelf switched off nothing dropped is kept.
  const keep = useCallback(async (paths: string[]) => {
    if (paths.length === 0 || !now.current.state.enabled.includes("shelf")) return;
    setShelfTrouble(null);
    setKeeping(true);
    try {
      const items = await command<Shelved[]>("shelf_add");
      if (items) setShelf(items);
      dispatch({ type: "lately", tab: "shelf" });
    } catch (failure) {
      setShelfTrouble(String(failure));
    } finally {
      setKeeping(false);
    }
  }, [dispatch]);

  useEffect(() => {
    const stops = [
      on<Notch>("island:screen", (found) => setNotch(found)),
      on<boolean>("island:hover", (over) => dispatch({ type: "hover", over })),
      // The hotkey or the name: the icosahedron comes back, and the conversation starts over.
      on("island:summon", () => {
        era.current += 1;
        setAsking(false);
        tell({ type: "cleared" });
        dispatch({ type: "summon" });
      }),
      on("island:dismiss", () => dispatch({ type: "dismiss" })),
      on("island:away", () => dispatch({ type: "away" })),
      on<Tab[]>("island:tabs", (enabled) => setTabsSet(enabled)),
      on<string[]>("island:widgets", (on) => setWidgets(on)),
      on<Tab | null>("island:home", (tab) => dispatch({ type: "home", tab })),
      on<Snapshot>("glance:stats", (seen) => setSnapshot(seen)),
      on<Clock>("pomodoro:state", (kept) => setClock(kept)),
      on<Playing | null>("music:now", (heard) => setPlaying(heard)),
      on<{ track: string; art: string }>("music:art", (found) => setArt(found)),
      on("pomodoro:rang", () => dispatch({ type: "rang" })),
      on<Speaking>("orb:state", (said) => setVoice(said)),
      on<number>("orb:energy", (level) => {
        energy.current = level;
      }),
      on<{ text: string; final: boolean }>("transcript", (heard) => {
        tell({ type: "heard", text: heard.text, final: heard.final });
        if (heard.final) dispatch({ type: "said" });
      }),
      // Replies stream for every turn, including ones typed in the main window; only the ones
      // this island is waiting on are shown.
      on<string>("agent:text", (chunk) => {
        const { state: s, voice: v, asking: a } = now.current;
        if ((s.summoned && v === "thinking") || a) tell({ type: "chunk", text: chunk });
      }),
      on<string>("agent:reply", (text) => {
        tell({ type: "replied", text, asked: "spoken" });
        dispatch({ type: "replied" });
      }),
      on<{ model: string }>("agent:route", (chosen) => setRoute(chosen.model)),
      // A coding agent stopped at a permission prompt, which it holds back while the island asks.
      on<AgentAsk>("agent:permission", (ask) => {
        setAsks((was) => (was.some((one) => one.id === ask.id) ? was : [...was, ask]));
        setAskNote(null);
        dispatch({ type: "alert", id: ask.id });
        // Told it is here, the core holds it; a question no island takes goes back to the agent.
        void command("coding_seen", { id: ask.id }).catch(() => undefined);
      }),
      on<{ id: string }>("agent:permission-done", (done) => {
        setAsks((was) => was.filter((one) => one.id !== done.id));
        dispatch({ type: "answered", id: done.id });
      }),
      on<PermissionRequest>("permission", (request) => {
        setAlerts((was) => (was.some((one) => one.id === request.id) ? was : [...was, request]));
        dispatch({ type: "alert", id: request.id });
      }),
      on<string>("permission:answered", (id) => {
        setAlerts((was) => was.filter((one) => one.id !== id));
        dispatch({ type: "answered", id });
      }),
      on<Firing>("presence:notice", () => {
        void refreshNotices();
        dispatch({ type: "notice" });
      }),
      on("presence:looked", () => void refreshNotices()),
      on<{ id: string; step: string; tool: string; target: string }>("mind:step", (began) =>
        setSteps((was) => [{ ...began, at: Date.now() }, ...was].slice(0, 30)),
      ),
      on<{ sessions: Session[] }>("coding:sessions", (seen) => setCoding(seen.sessions ?? [])),
      on<Finished>("coding:done", (one) => {
        setTold(one);
        setFinished((was) => ({ ...was, [one.session]: { ...one, at: Date.now() } }));
        dispatch({ type: "done" });
      }),
      on<{ step: string; ok: boolean }>("mind:step-done", (done) =>
        setSteps((was) => was.map((one) => (one.step === done.step ? { ...one, ok: done.ok } : one))),
      ),
      on<Shelved[]>("shelf:changed", (items) => setShelf(items)),
      // Outside the app only: a session's detail for the preview, and its steps opened.
      on<{ detail: Detail; steps: Record<string, StepDetail> }>("preview:detail", (seen) => {
        previewSteps.current = seen.steps;
        setDetail(seen.detail);
      }),
      on<string[]>("island:shortcuts", (names) => setShortcuts(names)),
      // Outside the app only: books for the preview's shortcuts.
      on<Book[]>("preview:books", (listed) => setBooks(listed)),
      on<string>("shelf:trouble", (said) => setShelfTrouble(said)),
      onCarried((carried) => {
        if (carried.type === "enter") {
          setCarrying(true);
          dispatch({ type: "drag" });
        } else if (carried.type === "leave") {
          setCarrying(false);
        } else if (carried.type === "drop") {
          setCarrying(false);
          void keep(carried.paths);
        }
      }),
    ];
    void command<Notch>("island_screen").then((found) => {
      if (found && found.width > 0) setNotch(found);
    });
    void command<Tab[]>("island_tabs").then((enabled) => {
      if (enabled) setTabsSet(enabled);
    });
    void command<string[]>("island_widgets").then((on) => setWidgets(on ?? []));
    void command<Tab | null>("island_home").then((tab) => dispatch({ type: "home", tab: tab ?? null }));
    void command<Clock>("pomodoro_state").then((kept) => kept && setClock(kept));
    void command<Playing | null>("music_now").then((heard) => {
      if (!heard) return;
      setPlaying(heard);
      if (heard.track) void command<string | null>("music_art", { track: heard.track }).then((found) => found && setArt({ track: heard.track!, art: found }));
    });
    // Questions held while this page was loading are taken up as if they had just arrived.
    void command<{ asks: AgentAsk[] }>("coding_asks")
      .then((held) => {
        const found = held?.asks ?? [];
        setAsks(found);
        for (const ask of found) {
          dispatch({ type: "alert", id: ask.id });
          void command("coding_seen", { id: ask.id }).catch(() => undefined);
        }
      })
      .catch(() => setAsks([]));
    void command<{ sessions: Session[] }>("coding_sessions")
      .then((seen) => setCoding(seen?.sessions ?? []))
      .catch(() => setCoding([]));
    void command<Shelved[]>("shelf_list").then((items) => setShelf(items ?? []));
    void command<string[]>("island_shortcuts").then((names) => setShortcuts(names ?? []));
    void refreshNotices();
    return () => {
      for (const stop of stops) void stop.then((unlisten) => unlisten());
    };
  }, [dispatch, refreshNotices, keep]);

  useEffect(() => {
    const set = tabsSet ?? [...TABS];
    // The glance is a page only with a widget on it, and the shortcuts only with one chosen.
    dispatch({
      type: "tabs",
      enabled: set.filter((tab) => (tab !== "glance" || widgets.length > 0) && (tab !== "shortcuts" || shortcuts.length > 0)),
    });
  }, [dispatch, tabsSet, widgets, shortcuts.length]);

  // The host tells the glance every second only while it is looked at.
  const glancing = state.mode === "open" && ready === "open" && state.tab === "glance";
  useEffect(() => {
    void command("glance_watch", { on: glancing });
    if (glancing) void command<Snapshot>("glance_stats").then((seen) => seen && setSnapshot(seen));
  }, [glancing]);

  // The player is asked again while its widget is looked at; the host asks only once allowed to.
  const listening = glancing && widgets.includes("music");
  useEffect(() => {
    if (!listening) return;
    void command("music_refresh");
    const asking = setInterval(() => void command("music_refresh"), 2_000);
    return () => clearInterval(asking);
  }, [listening]);

  // Looked at again on opening, for anything moved out of it in the Finder meanwhile.
  const shelving = state.mode === "open" && state.tab === "shelf";
  useEffect(() => {
    if (shelving) void command<Shelved[]>("shelf_list").then((items) => items && setShelf(items));
  }, [shelving]);

  // Folded, nothing is being carried over it, whether or not the webview heard the drag leave.
  useEffect(() => {
    if (state.mode === "hidden") setCarrying(false);
  }, [state.mode]);

  // An opened session is looked at again every two seconds while it shows. It stays open through a
  // fold or another page for as long as the island keeps the user's place, and closes once the
  // island opens afresh, on the list where a session newly waiting is, or as its session ends.
  const watchingId = watching?.id ?? null;
  const watchingHarness = watching?.harness ?? null;
  const showingDetail = state.mode === "open" && state.tab === "coding" && watchingId !== null;
  useEffect(() => {
    if (state.mode === "open" && state.kept === null) setWatching(null);
  }, [state.mode, state.kept]);
  useEffect(() => {
    if (watchingId !== null && !coding.some((one) => one.id === watchingId)) setWatching(null);
  }, [coding, watchingId]);
  // Each look asks only for what changed since the reading had, which a long session needs: the
  // whole of one is sent once.
  const reading = useRef<Detail | null | undefined>(undefined);
  reading.current = detail;
  useEffect(() => {
    if (!showingDetail) return;
    let stopped = false;
    const look = () => {
      const had = reading.current;
      void command<{ detail: Detail | null }>("coding_detail", { session: watchingId, harness: watchingHarness, since: had?.seq ?? 0, epoch: had?.epoch ?? null })
        .then((got) => {
          if (!stopped && got) setDetail((was) => (got.detail ? merged(was, got.detail) : null));
        })
        .catch(() => {
          if (!stopped) setDetail((was) => (was === undefined ? null : was));
        });
    };
    look();
    const every = setInterval(look, 2_000);
    return () => {
      stopped = true;
      clearInterval(every);
    };
  }, [showingDetail, watchingId, watchingHarness]);

  const previewSteps = useRef<Record<string, StepDetail>>({});
  const loadStep = useCallback<LoadStep>(
    (id, agent, whole) =>
      command<{ step: StepDetail | null }>("coding_step", { session: watchingId, step: id, agent: agent ?? null, whole: whole ?? false })
        .then((got) => (got === undefined ? (previewSteps.current[id] ?? null) : got.step))
        .catch(() => undefined),
    [watchingId],
  );

  const working = voice === "thinking" || steps.some((one) => one.ok === undefined && Date.now() - one.at < STALE);
  const agentsWaiting = waitingBesides(coding, asks);
  useEffect(() => {
    dispatch({ type: "agents", waiting: agentsWaiting });
  }, [dispatch, agentsWaiting]);
  useEffect(() => {
    if (working !== state.working) dispatch({ type: "working", on: working });
  }, [dispatch, working, state.working]);

  useEffect(() => {
    if (state.mode !== "open") return;
    void command<{ playbooks: Listed[] }>("playbooks_list")
      .then((listed) => {
        if (!listed) return;
        setPending(listed.playbooks.filter((one) => one.pending).length);
        setBooks(listed.playbooks);
      })
      .catch(() => setPending(0));
  }, [state.mode]);

  // A run can take minutes; one that ends while the island is folded is news for the next open.
  const runShortcut = async (name: string, text: string) => {
    setRunningShortcut(name);
    setRan(null);
    setRunTrouble(null);
    try {
      const done = await command<Invoked>("playbook_invoke", { name, text, pane: "chat" });
      if (done) setRan({ name, outcome: done.outcome, answer: done.answer });
    } catch (failure) {
      setRunTrouble(String(failure));
    } finally {
      setRunningShortcut(null);
      if (now.current.state.mode === "hidden") dispatch({ type: "lately", tab: "shortcuts" });
    }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (now.current.state.summoned) void command("island_dismiss");
      dispatch({ type: "escape" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch]);

  // An answer that cannot be delivered leaves the agent to ask in its own window when its wait ends,
  // and one that arrives after the agent stopped waiting is said, not taken as given.
  const answerAsk = (id: string, decision: Decision) => {
    setAsks((was) => was.filter((one) => one.id !== id));
    dispatch({ type: "answered", id });
    void command<{ answered: boolean }>("coding_answer", { id, decision })
      .then((got) => {
        if (got && !got.answered && decision !== "ask") setAskNote("That one had already gone back, to be asked in its own window.");
      })
      .catch((failure) => setAskNote(`That answer could not be given: ${String(failure)}`));
  };

  const answer = async (id: string, allow: boolean) => {
    setAlerts((was) => was.filter((one) => one.id !== id));
    dispatch({ type: "answered", id });
    try {
      await resolvePermission(id, allow);
    } catch {
      // The main window still holds the question; it can be answered there.
    }
  };

  // Typed messages carry on one session, so the chat on the island is one conversation.
  const askIt = async (prompt: string) => {
    const session = now.current.thread.session;
    const asked = era.current;
    tell({ type: "typed", text: prompt });
    dispatch({ type: "said" });
    setAsking(true);
    try {
      const answered = await ask(prompt, session ? { session } : { pane: "chat" });
      setRoute(answered.model);
      if (era.current === asked) {
        tell({ type: "replied", text: answered.text, asked: "typed", session: answered.session });
        dispatch({ type: "replied" });
      }
    } catch (failure) {
      if (era.current === asked) tell({ type: "failed", reason: `That could not be asked: ${String(failure)}`, asked: "typed" });
    } finally {
      if (era.current === asked) setAsking(false);
    }
  };

  const open = state.mode === "open" && ready === "open";
  const peek = state.mode === "peek" && ready === "peek";
  const left = (PANEL_WIDTH - OPEN_WIDTH) / 2;
  const notchLeft = (PANEL_WIDTH - notch.width) / 2;
  const notchRight = notchLeft + notch.width;
  const fresh = state.noticeUntil > performance.now() || notices.length > 0;
  const waitingOnYou = alerts.length + asks.length + agentsWaiting;
  const sign = waitingOnYou > 0 ? String(waitingOnYou) : state.noticeUntil > performance.now() ? "•" : working ? "…" : "";
  const bandEdge = (notch.height + 14) / OPEN_HEIGHT;
  const line = peek && telling && told ? toldOf(told) : null;

  return (
    <div className={insideTauri() ? "panel" : "panel preview"}>
      {/* Back to front: the glass, the icosahedron's light, then the notch's black and the border
          over both, so its light fades into the notch and never crosses the edge. */}
      <div ref={body} className="body">
        <svg className="shape" width={PANEL_WIDTH} height={PANEL_HEIGHT} viewBox={`0 0 ${PANEL_WIDTH} ${PANEL_HEIGHT}`}>
          <defs>
            {/* The main window's glass: dark and painted, a little lighter in the middle. */}
            <radialGradient id="glass" gradientUnits="userSpaceOnUse" cx={PANEL_WIDTH / 2} cy={OPEN_HEIGHT / 2} r={PANEL_WIDTH / 2}>
              <stop offset="0" stopColor="rgb(17 17 27)" stopOpacity="0.72" />
              <stop offset="0.45" stopColor="rgb(13 13 22)" stopOpacity="0.88" />
              <stop offset="1" stopColor="rgb(7 7 13)" stopOpacity="0.96" />
            </radialGradient>
          </defs>
          <path ref={fill} className="fill" fill="url(#glass)" onClick={() => dispatch({ type: "click" })} />
        </svg>
        <canvas ref={canvas} className="face" style={{ width: PANEL_WIDTH, height: PANEL_HEIGHT }} />
        <svg className="shape rim" width={PANEL_WIDTH} height={PANEL_HEIGHT} viewBox={`0 0 ${PANEL_WIDTH} ${PANEL_HEIGHT}`}>
          <defs>
            <linearGradient id="notch-band" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={OPEN_HEIGHT}>
              <stop offset="0" stopColor="#000" stopOpacity="1" />
              <stop offset={(notch.height - 2) / OPEN_HEIGHT} stopColor="#000" stopOpacity="1" />
              <stop offset={bandEdge} stopColor="#000" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path ref={band} className="band" fill="url(#notch-band)" />
          <path ref={edge} className="edge" fill="none" />
        </svg>
      </div>

      <div className="header" style={{ height: notch.height }}>
        <span className={open ? "status shown" : "status"} style={{ left: left + 20, width: Math.max(0, notchLeft - left - 34) }}>
          {voice !== "idle" ? voice : asking ? "asking" : state.tab === "voice" && route ? route : ""}
        </span>
        <div className={open ? "tabs shown" : "tabs"} style={{ left: notchRight + 14 }}>
          {state.enabled.map((tab) => (
            <button
              key={tab}
              type="button"
              className={tab === state.tab ? "tab on" : "tab"}
              title={TITLES[tab]}
              onClick={() => dispatch({ type: "pick", tab })}
            >
              <TabIcon tab={tab} />
              {tab === "permissions" && alerts.length + asks.length + pending > 0 ? (
                <span className="count">{alerts.length + asks.length + pending}</span>
              ) : null}
              {tab === "coding" && agentsWaiting > 0 ? <span className="count">{agentsWaiting}</span> : null}
              {tab === "notices" && fresh ? <span className="dot" /> : null}
            </button>
          ))}
        </div>
        <span className={peek && sign && !line ? "sign shown" : "sign"} style={{ left: notchRight + (SIDE - 18) / 2, top: (notch.height - 18) / 2 }}>
          {sign}
        </span>
        <span className={line ? "wing left shown" : "wing left"} style={{ right: PANEL_WIDTH - notchLeft + 14, width: WING - 26 }}>
          {line?.who}
        </span>
        <span className={line ? `wing right shown ${line.state ?? ""}` : "wing right"} style={{ left: notchRight + 14, width: WING - 26 }}>
          {line?.how}
        </span>
      </div>

      <div
        className={open ? "content shown" : "content"}
        style={{ left: left + 18, top: notch.height + 8, width: OPEN_WIDTH - 36, height: OPEN_HEIGHT - notch.height - 20 }}
      >
        {state.tab === "voice" ? (
          <Voice
            chatting={state.chatting}
            bubbles={thread.bubbles}
            voice={voice}
            asking={asking}
            onAsk={(prompt) => void askIt(prompt)}
            onReach={() => void command("island_focus", { on: true })}
            onLeave={() => void command("island_focus", { on: false })}
          />
        ) : null}
        {state.tab === "permissions" ? (
          <Permissions
            alerts={alerts}
            asks={asks}
            pending={pending}
            shown={open}
            note={askNote}
            onAnswer={(id, allow) => void answer(id, allow)}
            onAsk={answerAsk}
            onReview={() => void command("island_reveal")}
          />
        ) : null}
        {state.tab === "work" ? <Work steps={steps} /> : null}
        {state.tab === "coding" && watching ? (
          <CodingDetail
            session={coding.find((one) => one.id === watching.id) ?? watching}
            detail={detail}
            onBack={() => {
              dispatch({ type: "stay" });
              setWatching(null);
            }}
            onReveal={() => command<string>("coding_reveal", { session: watching.id }).then(() => undefined)}
            load={loadStep}
            live={state.mode === "open"}
          />
        ) : null}
        {state.tab === "coding" && !watching ? (
          <Coding
            sessions={coding}
            finished={finished}
            onOpen={(one) => {
              dispatch({ type: "stay" });
              setDetail(undefined);
              setWatching(one);
            }}
          />
        ) : null}
        {state.tab === "glance" ? (
          <Glance
            widgets={widgets}
            snapshot={snapshot}
            timer={{
              clock,
              start: () => void command<Clock>("pomodoro_start").then((kept) => kept && setClock(kept)),
              pause: () => void command<Clock>("pomodoro_pause").then((kept) => kept && setClock(kept)),
              reset: () => void command<Clock>("pomodoro_reset").then((kept) => kept && setClock(kept)),
              period: (period) => void command<Clock>("pomodoro_period", { period }).then((kept) => kept && setClock(kept)),
            }}
            player={{
              playing,
              art: playing?.track && art?.track === playing.track ? art.art : null,
              trouble,
              control: (action, value) => {
                setTrouble(null);
                void command("music_control", { action, value }).catch((failure) => setTrouble(String(failure)));
              },
              // A level the player took clears what went wrong before; one slid past is not worth a
              // warning, since the next replaces it, so only the level let go on can raise one.
              volume: (level, settled) =>
                command("music_control", { action: "volume", value: level, settle: settled }).then(
                  () => setTrouble(null),
                  (failure) => {
                    if (settled) setTrouble(String(failure));
                  },
                ),
              ask: () => {
                setTrouble(null);
                void command("music_introduce").catch((failure) => setTrouble(String(failure)));
              },
            }}
          />
        ) : null}
        {state.tab === "shelf" ? (
          <Shelf
            items={shelf}
            carrying={carrying}
            keeping={keeping}
            trouble={shelfTrouble}
            onDrag={(id, copying) => {
              setShelfTrouble(null);
              void command("shelf_drag", { id, copying }).catch((failure) => setShelfTrouble(String(failure)));
            }}
            onRemove={(id) =>
              void command<Shelved[]>("shelf_remove", { id })
                .then((items) => items && setShelf(items))
                .catch((failure) => setShelfTrouble(String(failure)))
            }
            onReveal={(id) => void command("shelf_reveal", { id }).catch((failure) => setShelfTrouble(String(failure)))}
          />
        ) : null}
        {state.tab === "shortcuts" ? (
          <Shortcuts
            books={chosen(shortcuts, books)}
            running={runningShortcut}
            ran={ran}
            trouble={runTrouble}
            onRun={(name, text) => void runShortcut(name, text)}
            onReach={() => void command("island_focus", { on: true })}
            onLeave={() => void command("island_focus", { on: false })}
          />
        ) : null}
        {state.tab === "notices" ? <Notices notices={notices} /> : null}
      </div>

      {insideTauri() ? null : <Harness notch={notch} />}
    </div>
  );
}
