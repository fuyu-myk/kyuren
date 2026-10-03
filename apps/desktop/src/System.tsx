import { useCallback, useEffect, useState } from "react";
import { onReply, onRoute, type Chosen } from "@/agent";
import { onLevel, onSpeech, onTranscript, type Transcript } from "@/audio";
import { ambientLook, ambientRecent, ambientState, onPresence, type AmbientState, type Firing } from "@/ambient";
import { nextOf, timeOf } from "@/news";
import { captureScreen, type Capture } from "@/capture";
import { Connections } from "@/Connections";
import { heldSecrets, morningBrief, onConnections, showMind, type Brief } from "@/connect";
import { onOrbState } from "@/orb";
import { Page } from "@/Page";
import { Playbooks } from "@/Playbooks";
import { readStatus, type Probe, type Status } from "@/sidecars";
import { onSummoned } from "@/summon";
import { Notes } from "@/Notes";
import { speak } from "@/voice";
import { wakeListen, wakeState, type WakeState } from "@/wake";
import { Web } from "@/Web";
import { CodingAgents } from "@/CodingAgents";
import { IslandLayout } from "@/IslandLayout";

function Row({ label, probe }: { label: string; probe: Probe | undefined }) {
  const state = probe === undefined ? "pending" : probe.ok ? "up" : "down";
  const detail = probe === undefined
    ? "probing"
    : probe.ok
      ? `${probe.result.name} ${probe.result.version}`
      : probe.error;

  return (
    <li className={`row row-${state}`}>
      <span className="dot" />
      <span className="label">{label}</span>
      <span className="detail">{detail}</span>
    </li>
  );
}

/// What Kyuren is made of and whether it is working: the sidecars, the microphone, the voice, and
/// what it is connected to. Kept as its own surface so the panes are about the work instead.
export function System() {
  const [status, setStatus] = useState<Status>();
  const [error, setError] = useState<string>();
  const [summoned, setSummoned] = useState(0);
  const [level, setLevel] = useState(0);
  const [peak, setPeak] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [utterances, setUtterances] = useState(0);
  const [heard, setHeard] = useState<Transcript>();
  const [orbState, setOrbState] = useState("idle");
  const [reply, setReply] = useState<string>();
  const [chosen, setChosen] = useState<Chosen>();
  const [connections, setConnections] = useState<string[]>([]);
  const [brief, setBrief] = useState<Brief>();
  const [gathering, setGathering] = useState(false);
  const [taken, setTaken] = useState<Capture>();
  const [capturing, setCapturing] = useState(false);
  const [wake, setWake] = useState<WakeState>();
  const [ambient, setAmbient] = useState<AmbientState>();
  const [noticed, setNoticed] = useState<Firing[]>([]);
  const [looking, setLooking] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await readStatus());
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const pending = onSummoned(() => setSummoned((count) => count + 1));
    return () => void pending.then((unlisten) => unlisten());
  }, []);

  useEffect(() => {
    const pending = onReply(setReply);
    return () => void pending.then((unlisten) => unlisten());
  }, []);

  useEffect(() => {
    const pending = onRoute(setChosen);
    return () => void pending.then((unlisten) => unlisten());
  }, []);

  useEffect(() => {
    void heldSecrets().then(setConnections).catch(() => setConnections([]));
  }, []);

  useEffect(() => {
    const pending = onConnections(setConnections);
    return () => void pending.then((unlisten) => unlisten());
  }, []);

  useEffect(() => {
    const pending = onOrbState(setOrbState);
    return () => void pending.then((unlisten) => unlisten());
  }, []);

  useEffect(() => {
    const pending = onTranscript(setHeard);
    return () => void pending.then((unlisten) => unlisten());
  }, []);

  useEffect(() => {
    const pending = onSpeech((active) => {
      setSpeaking(active);
      if (active) setUtterances((count) => count + 1);
    });
    return () => void pending.then((unlisten) => unlisten());
  }, []);

  useEffect(() => {
    const pending = onLevel((next) => {
      setLevel(next);
      setPeak((highest) => Math.max(highest, next));
    });
    return () => void pending.then((unlisten) => unlisten());
  }, []);

  const gather = useCallback(async () => {
    setGathering(true);
    try {
      setBrief(await morningBrief());
    } catch (failure) {
      setError(String(failure));
    } finally {
      setGathering(false);
    }
  }, []);

  const readWake = useCallback(async () => {
    try {
      setWake(await wakeState());
    } catch {
      setWake(undefined);
    }
  }, []);

  useEffect(() => {
    void readWake();
  }, [readWake]);

  const readAmbient = useCallback(async () => {
    try {
      setAmbient(await ambientState());
      setNoticed(await ambientRecent());
    } catch {
      setAmbient(undefined);
    }
  }, []);

  useEffect(() => {
    void readAmbient();
  }, [readAmbient]);

  useEffect(() => {
    let stop: (() => void) | undefined;
    void onPresence(() => void readAmbient()).then((done) => {
      stop = done;
    });
    return () => stop?.();
  }, [readAmbient]);

  const lookNow = useCallback(async () => {
    setLooking(true);
    try {
      await ambientLook();
    } catch (failure) {
      setError(String(failure));
    } finally {
      setLooking(false);
      await readAmbient();
    }
  }, [readAmbient]);

  const listenForName = useCallback(async (on: boolean) => {
    try {
      await wakeListen(on);
    } catch (failure) {
      setError(String(failure));
    }
    await readWake();
  }, [readWake]);

  const capture = useCallback(async () => {
    setCapturing(true);
    try {
      setTaken(await captureScreen());
    } catch (failure) {
      setError(String(failure));
    } finally {
      setCapturing(false);
    }
  }, []);

  return (
    <Page title="system">
      <ul className="rows">
        <Row label="cognition" probe={status?.core} />
        <Row label="perception" probe={status?.perception} />
      </ul>

      <section>
        <h3>voice</h3>
        {heard?.text ? <p className="heard final">{heard.text}</p> : null}
        {reply ? <p className="reply">{reply}</p> : null}
        {reply && chosen ? (
          <p className="chosen">
            answered by <strong>{chosen.model}</strong>, {chosen.reason}
          </p>
        ) : null}
        <div className="meter" role="meter" aria-label="microphone level">
          <div className="meter-fill" style={{ width: `${(level * 100).toFixed(1)}%` }} />
          <div className="meter-peak" style={{ left: `${(peak * 100).toFixed(1)}%` }} />
        </div>
        <p className={speaking ? "hint voice-on" : "hint"}>
          orb {orbState}, {speaking ? "voice detected" : "silent"}, {utterances} utterances, input{" "}
          {level.toFixed(2)}, peak {peak.toFixed(2)}, summoned {summoned}x
        </p>
      </section>

      <section>
        <h3>today</h3>
        <div className="actions">
          <button type="button" onClick={() => void gather()} disabled={gathering}>
            {gathering ? "reading" : "what does today hold"}
          </button>
          <button type="button" onClick={() => void showMind()}>
            show mind
          </button>
        </div>
        {brief ? <pre className="facts">{brief.facts}</pre> : null}
      </section>

      <section>
        <h3>listening</h3>
        <div className="actions">
          <button
            type="button"
            className={wake?.wanted.on ? "on" : undefined}
            onClick={() => void listenForName(!wake?.wanted.on)}
            disabled={wake === undefined || (!wake.wanted.on && wake.live.tracker !== "ready")}
          >
            {wake?.wanted.on ? "disable listening" : "enable listening"}
          </button>
        </div>
        <p className="hint">
          {wake === undefined
            ? "asking"
            : wake.wanted.on
              ? `listening for "Hey Kyuren"; the microphone stays open for as long as this is on`
              : wake.live.tracker === "ready"
                ? "off; the microphone is closed until you summon Kyuren"
                : wake.live.tracker}
        </p>
      </section>

      <section>
        <h3>presence</h3>
        <p className="hint">
          {ambient === undefined
            ? "asking"
            : ambient.trouble
              ? `the rules could not be read: ${ambient.trouble}`
              : !ambient.enabled
                ? `off; nothing reaches you unasked and no schedule runs. Rules live in ${ambient.file}`
                : `${ambient.rules.length} rule${ambient.rules.length === 1 ? "" : "s"}${ambient.schedules.length ? `, ${ambient.schedules.length} schedule${ambient.schedules.length === 1 ? "" : "s"}` : ""}, looked at every ${ambient.every} minute${ambient.every === 1 ? "" : "s"}, reading ${ambient.read.join(", ") || "nothing yet"}`
                  + (ambient.lastLook
                    ? `; last look ${ambient.lastLook.at.slice(11, 16)} read ${ambient.lastLook.read.join(", ") || "nothing"}`
                      + (ambient.lastLook.notAllowed.length ? `, not yet allowed: ${ambient.lastLook.notAllowed.join(", ")}` : "")
                    : "")}
        </p>
        {ambient?.enabled ? (
          <div className="actions">
            <button type="button" onClick={() => void lookNow()} disabled={looking}>
              {looking ? "looking" : "look now"}
            </button>
          </div>
        ) : null}
        {ambient?.enabled && ambient.schedules.length ? (
          <ul className="rows">
            {ambient.schedules.map((one) => (
              <li key={one.id} className="row">
                <span className="dot" />
                <span className="label">{one.id}</span>
                <span className="detail">
                  {one.playbook} at {one.at}, {one.on ? one.on.join(" ") : "every day"}, next {nextOf(one.next)}
                  {one.last ? `; last ${timeOf(one.last.at)} ${one.last.why}` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {noticed.length ? (
          <ul className="rows">
            {noticed.map((one) => (
              <li key={`${one.rule}-${one.at}`} className="row row-up">
                <span className="dot" />
                <span className="label">{one.title}</span>
                <span className="detail">
                  {one.at.slice(11, 16)} {one.why}, by {one.rule}{one.voice ? ", spoken" : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section>
        <h3>screen</h3>
        <div className="actions">
          <button type="button" onClick={() => void capture()} disabled={capturing}>
            {capturing ? "capturing" : "capture the screen"}
          </button>
        </div>
        <p className="hint">
          {taken
            ? `${taken.width} by ${taken.height}, kept at ${taken.path}`
            : "one frame, only when you ask, and it stays on this machine"}
        </p>
      </section>

      <Notes onTrouble={setError} />

      <Playbooks onTrouble={setError} />

      <Web onTrouble={setError} />

      <IslandLayout onTrouble={setError} />

      <CodingAgents onTrouble={setError} />

      <Connections connected={connections} onConnected={setConnections} onTrouble={setError} />

      <div className="actions">
        <button type="button" onClick={() => void refresh()}>
          probe
        </button>
        <button
          type="button"
          onClick={() =>
            void speak(
              "Your first meeting is at nine with the design team. The afternoon is completely clear, and two messages are waiting for a reply.",
            )
          }
        >
          test voice
        </button>
      </div>

      {error ? <p className="error">{error}</p> : null}
    </Page>
  );
}
