import { useCallback, useEffect, useRef, useState } from "react";
import { ThinkingOrb } from "thinking-orbs";
import { Board } from "@/Board";
import { parseCommand, type Command } from "@/commands";
import { Composer } from "@/Composer";
import { Forge } from "@/Forge";
import { Markdown } from "@/Markdown";
import { Noticed } from "@/Noticed";
import { Page } from "@/Page";
import { paneNamed, type Pane } from "@/panes";
import { invokePlaybook, listPlaybooks } from "@/playbook";
import { Recent } from "@/Recent";
import { Research } from "@/Research";
import { Standing, type Choice, type Stood } from "@/Standing";
import { stopTurn } from "@/stopping";
import { insideTauri } from "@/tauri";
import {
  ask,
  askable,
  capabilities,
  forgetSession,
  listSessions,
  readSession,
  renameSession,
  runCapability,
  type Asked,
  type Called,
  type Capability,
  preferSession,
  type Session,
  type Turn,
} from "@/sessions";

type PlaceProps = {
  pane: Pane;
};

/// What was said, and for an answer, what it reached for on the way.
type Said = Turn & { called?: Called[] };

/// How long the capabilities take to get out of the way once something has been asked.
const CLEARING = 280;

/// Commands for a browser preview with no sidecars, so the menu can be seen and judged.
const SKETCHED: Command[] = [
  { name: "research", about: "answer a question from the web, with sources", kind: "playbook" },
  { name: "today", about: "what the day holds", kind: "capability" },
  { name: "remember", about: "search the notes", kind: "capability" },
];

const KEPT = "kyuren.route";

/// The default for a new conversation: whatever was chosen last.
function kept(): Choice {
  try {
    const held = localStorage.getItem(KEPT);
    return held === "local-small" || held === "local-large" || held === "cloud" ? held : "auto";
  } catch {
    return "auto";
  }
}

/// What answered last in a conversation read back from the store.
function stoodIn(turns: Turn[]): Stood | undefined {
  for (let at = turns.length - 1; at >= 0; at -= 1) {
    const by = turns[at]?.by;
    if (by) return by;
  }
  return undefined;
}

export function Place({ pane }: PlaceProps) {
  const about = paneNamed(pane);
  const [known, setKnown] = useState<Capability[]>([]);
  const [canRun, setCanRun] = useState<Asked[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [open, setOpen] = useState<Session>();
  const [turns, setTurns] = useState<Said[]>([]);
  const [leaving, setLeaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [trouble, setTrouble] = useState<string>();
  const [commands, setCommands] = useState<Command[]>([]);
  const [produced, setProduced] = useState(0);
  const [choice, setChoice] = useState<Choice>(kept);
  const [last, setLast] = useState<Stood>();
  const clearing = useRef<number>(0);
  // The turn being waited on, so it can be stopped: a playbook run by the name it was started
  // under, a question by none. One that was stopped ends as stopped, not as trouble.
  const waiting = useRef<{ id?: string; stopped: boolean } | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      // Chat sees every conversation, wherever it was started; a pane sees its own.
      setSessions(await listSessions(pane === "chat" ? undefined : pane));
      setTrouble(undefined);
    } catch (failure) {
      setTrouble(String(failure));
    }
  }, [pane]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void capabilities().then(setKnown).catch(() => setKnown([]));
    void askable().then(setCanRun).catch(() => setCanRun([]));
  }, []);

  // A slash offers the approved playbooks and whatever can be run as it stands.
  useEffect(() => {
    if (!insideTauri()) {
      setCommands(SKETCHED);
      return;
    }
    void listPlaybooks()
      .catch(() => [])
      .then((books) =>
        setCommands([
          ...books
            .filter((one) => one.approved)
            .map((one) => ({ name: one.name, about: one.when, kind: "playbook" as const })),
          ...canRun.map((one) => ({
            name: one.name,
            about: known.find((each) => each.label === one.name)?.description ?? one.asking,
            kind: "capability" as const,
          })),
        ]),
      );
  }, [canRun, known, produced]);

  useEffect(() => () => window.clearTimeout(clearing.current), []);

  const show = useCallback(async (id: string) => {
    try {
      const held = await readSession(id);
      setOpen(held.session);
      setTurns(held.turns);
      setLast(stoodIn(held.turns));
      setChoice(held.session.preferred ?? "auto");
      setTrouble(undefined);
    } catch (failure) {
      setTrouble(String(failure));
    }
  }, []);

  /// Gets the capabilities out of the way before the first thing said lands in their place.
  function clear(): void {
    if (turns.length > 0) return;
    setLeaving(true);
    window.clearTimeout(clearing.current);
    clearing.current = window.setTimeout(() => setLeaving(false), CLEARING);
  }

  /// Follows whichever session a turn ended up in, without disturbing what is on screen.
  async function follow(id: string | undefined): Promise<void> {
    if (!id || open?.id === id) return;
    try {
      setOpen((await readSession(id)).session);
    } catch {
      // Losing the name of a session is not worth losing the answer over.
    }
  }

  /// A playbook by slash: run, proved, and answered with what it produced.
  async function runBook(name: string, text: string, saying: string): Promise<void> {
    clear();
    setBusy(true);
    setTrouble(undefined);
    setTurns((held) => [...held, { role: "user", text: saying, at: Date.now() }]);
    const id = `${pane}:${crypto.randomUUID()}`;
    waiting.current = { id, stopped: false };
    try {
      const ran = await invokePlaybook(name, text, pane, id);
      setTurns((held) => [...held, { role: "assistant", text: ran.answer, at: Date.now() }]);
      setProduced((count) => count + 1);
      await follow(ran.session);
      await load();
    } catch (failure) {
      if (!waiting.current?.stopped) setTrouble(String(failure));
    } finally {
      waiting.current = undefined;
      setBusy(false);
    }
  }

  async function send(saying: string): Promise<void> {
    // A slash names what to do; on the research page, a bare question is research.
    const command = parseCommand(saying) ?? (pane === "research" ? { name: "research", text: saying } : undefined);
    if (command) {
      if (commands.some((one) => one.kind === "playbook" && one.name === command.name)) {
        await runBook(command.name, command.text, saying);
        return;
      }
      const capability = known.find((one) => one.label === command.name);
      if (capability && canRun.some((one) => one.name === command.name)) {
        await run(capability);
        return;
      }
      setTrouble(`nothing is called /${command.name}`);
      return;
    }

    clear();
    setBusy(true);
    setTurns((held) => [...held, { role: "user", text: saying, at: Date.now() }]);
    waiting.current = { stopped: false };
    try {
      const answer = await ask(saying, open ? { session: open.id } : { pane }, choice === "auto" ? undefined : choice);
      setLast(answer);
      setTurns((held) => [
        ...held,
        { role: "assistant", text: answer.text, at: Date.now(), called: answer.called },
      ]);
      await follow(answer.session);
      await load();
    } catch (failure) {
      if (!waiting.current?.stopped) setTrouble(String(failure));
    } finally {
      waiting.current = undefined;
      setBusy(false);
    }
  }

  /// The choice is the open conversation's, and the default for the next one.
  function choose(next: Choice): void {
    setChoice(next);
    try {
      localStorage.setItem(KEPT, next);
    } catch {
      // Remembered for the session alone, then.
    }
    if (open) {
      void preferSession(open.id, next === "auto" ? undefined : next).catch((failure) =>
        setTrouble(String(failure)),
      );
    }
  }

  async function run(one: Capability): Promise<void> {
    const asked = canRun.find((each) => each.name === one.label);
    if (!asked || busy) return;

    clear();
    setBusy(true);
    setTrouble(undefined);
    // Shown as having been asked in the words it is actually asked in.
    setTurns((held) => [...held, { role: "user", text: asked.asking, at: Date.now() }]);
    waiting.current = { stopped: false };
    try {
      const answer = await runCapability(one.label, one.pane);
      setLast(answer);
      setTurns((held) => [
        ...held,
        { role: "assistant", text: answer.text, at: Date.now(), called: answer.called },
      ]);
      await follow(answer.session);
      await load();
    } catch (failure) {
      if (!waiting.current?.stopped) setTrouble(String(failure));
    } finally {
      waiting.current = undefined;
      setBusy(false);
    }
  }

  function stop(): void {
    const turn = waiting.current;
    if (!turn) return;
    waiting.current = { ...turn, stopped: true };
    void stopTurn(turn.id).catch((failure) => setTrouble(String(failure)));
  }

  function leave(): void {
    setOpen(undefined);
    setTurns([]);
    setLast(undefined);
    setChoice(kept());
    void load();
  }

  // Chat is about anything, so it offers everything; a pane offers what belongs to it.
  const offered = pane === "chat" ? known : known.filter((one) => one.pane === pane);
  const talking = turns.length > 0;

  return (
    <Page
      title={open ? open.title : about?.title ?? pane}
      about={open || talking ? undefined : about?.about}
      back={talking ? leave : undefined}
      onRename={open ? (named) => void renameSession(open.id, named).then(load) : undefined}
      composer={
        <div className="bar">
          <Composer
            placeholder={pane === "research" ? "a question to research, or / for a command" : "ask something, or / for a command"}
            busy={busy}
            onSend={(saying) => void send(saying)}
            onStop={stop}
            commands={commands}
          />
          <Standing choice={choice} onChoose={choose} last={last} />
        </div>
      }
    >
      {pane === "chat" ? <Noticed /> : null}
      {talking ? (
        <ol className="turns">
          {turns.map((turn, at) => (
            <li key={`${turn.at}-${at}`} className={turn.role}>
              <span className="who">{turn.role === "user" ? "you" : "kyuren"}</span>
              {turn.role === "assistant" ? <Markdown text={turn.text} /> : <p>{turn.text}</p>}
              {turn.called && turn.called.length > 0 ? (
                <details className="called">
                  <summary>
                    {turn.called.length} {turn.called.length === 1 ? "tool" : "tools"}
                  </summary>
                  <ul>
                    {turn.called.map((one, step) => (
                      <li key={`${one.tool}-${step}`} className={one.ok === false ? "failed" : ""}>
                        <span className="tool">{one.tool}</span>
                        <span className="target">{one.target}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </li>
          ))}
          {busy ? (
            <li className="assistant waiting">
              <span className="who">kyuren</span>
              <p className="thinking">
                <ThinkingOrb state="connecting" size={20} theme="dark" />
                <span className="shimmer">thinking</span>
              </p>
            </li>
          ) : null}
        </ol>
      ) : null}

      {!talking || leaving ? (
        <div className={leaving ? "home going" : "home"}>
          <section>
            <h3>{pane === "chat" ? "anything Kyuren can do" : "what this pane can do"}</h3>
            <ul className="capabilities">
              {offered.map((one) => {
                const runnable = canRun.some((each) => each.name === one.label);
                return (
                  <li key={one.id}>
                    <button
                      type="button"
                      className={runnable ? "capability" : "capability idle"}
                      disabled={!runnable || busy}
                      title={runnable ? undefined : "needs something to work on"}
                      onClick={() => void run(one)}
                    >
                      <span className="name">{one.label}</span>
                      <span className="says">{one.description}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          {pane === "knowledge" ? (
            <section>
              <h3>what Kyuren has forged</h3>
              <Forge />
            </section>
          ) : null}

          {pane === "development" ? (
            <section>
              <h3>where everything stands</h3>
              <Board onAsk={(about) => void send(`Where did I stop on ${about.name}?`)} />
            </section>
          ) : null}

          {pane === "research" ? <Research refresh={produced} /> : null}

          <section>
            <h3>past conversations</h3>
            <Recent
              sessions={sessions}
              showPane={pane === "chat"}
              empty="nothing has been asked yet"
              onOpen={(id) => void show(id)}
              onForget={(id) => void forgetSession(id).then(load)}
            />
          </section>
        </div>
      ) : null}

      {trouble ? <p className="error">{trouble}</p> : null}
    </Page>
  );
}
