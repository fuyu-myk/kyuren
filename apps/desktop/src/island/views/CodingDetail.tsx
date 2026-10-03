import { useEffect, useState } from "react";
import { type Detail, type Step, type StepDetail, type TestRun } from "@/island/steps";
import { DOT, doing, harnessName, type Session } from "@/island/views/Coding";
import { CodingStep, StepList } from "@/island/views/CodingStep";

/// Reads one step, of the session or of an agent it handed work to, with all it printed if `whole`:
/// null when it is not in the transcript, undefined when it could not be asked.
export type LoadStep = (id: string, agent?: string, whole?: boolean) => Promise<StepDetail | null | undefined>;

/// The detail is undefined until the core has answered, and null when it knows nothing more. Folded
/// away, the island is not `live`, and an opened step is not looked at again until it shows.
type Props = {
  session: Session;
  detail: Detail | null | undefined;
  onBack: () => void;
  /// Brings forward the app the session runs in.
  onReveal: () => Promise<void>;
  load: LoadStep;
  live: boolean;
};

/// Where a session runs, by where it was started from, for the button that brings it forward.
const RUNS_IN: Record<string, string> = { "the desktop app": "Claude", "VS Code": "VS Code", "a terminal": "its terminal" };
type Place = { id: string; agent?: string; title: string };

/// A step still going is looked at again this often while it is open.
const AGAIN = 2_000;

function counted(tests: TestRun): string {
  const parts = [tests.failed ? `${tests.failed} failed` : "", tests.passed !== null ? `${tests.passed} passed` : ""].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : tests.ok ? "passed" : "failed";
}

function titleOf(one: Step): string {
  return `${one.verb} ${one.target}`;
}

function BackIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path d="M10 3.5 5.5 8l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/// One step opened, read again while it is still going.
type ViewProps = { place: Place; load: LoadStep; live: boolean; onBack: () => void; onOpen: (place: Place) => void };

function StepView({ place, load, live, onBack, onOpen }: ViewProps) {
  const [shown, setShown] = useState<StepDetail | null | undefined>(undefined);
  const [whole, setWhole] = useState(false);

  useEffect(() => {
    if (!live) return;
    let stopped = false;
    let again: ReturnType<typeof setTimeout> | undefined;
    // An agent is looked at for as long as it is open, since it can be between steps of its own
    // while still working; a look that could not be made is tried again.
    const look = () =>
      void load(place.id, place.agent, whole).then((got) => {
        if (stopped) return;
        if (got !== undefined) setShown(got);
        if (got === undefined || got?.ok === null || got?.kind === "agent") again = setTimeout(look, AGAIN);
      });
    look();
    return () => {
      stopped = true;
      if (again) clearTimeout(again);
    };
  }, [place.id, place.agent, whole, load, live]);

  return (
    <div className="step-view">
      <p className="step-head" title={place.title}>
        <button type="button" className="up" title="back" onClick={onBack}>
          <BackIcon />
        </button>
        <span className="title">{place.title}</span>
      </p>
      {shown === undefined ? <p className="note">Reading the step.</p> : null}
      {shown === null ? <p className="note">This step is no longer in the session's transcript.</p> : null}
      {shown ? (
        <CodingStep
          detail={shown}
          onWhole={() => setWhole(true)}
          onOpen={(one) => onOpen({ id: one.id, title: titleOf(one), ...(shown.kind === "agent" && shown.agent ? { agent: shown.agent } : {}) })}
        />
      ) : null}
    </div>
  );
}

/// One session, opened from the coding list: the task it was given, its last test run and the files
/// it changed beside every step it has taken, newest first, each opening to what it did.
export function CodingDetail({ session, detail, onBack, onReveal, load, live }: Props) {
  const [picked, setPicked] = useState<string | null>(null);
  const [trail, setTrail] = useState<Place[]>([]);
  const [heard, setHeard] = useState(false);
  const [trouble, setTrouble] = useState<string | null>(null);
  const here = trail.at(-1);
  const file = detail?.files.find((one) => one.path === picked) ?? null;
  const steps = detail && file ? detail.steps.filter((one) => file.steps.includes(one.id)) : (detail?.steps ?? []);
  const open = (place: Place) => setTrail((was) => [...was, place]);

  return (
    <div className="view coding-detail">
      <div className="head">
        <button type="button" className="back" title="all sessions" onClick={onBack}>
          <BackIcon />
        </button>
        <span className={DOT[session.state]} />
        <strong>{session.project}</strong>
        <span className="meta">{[harnessName(session.harness), detail?.branch, doing(session)].filter(Boolean).join(" · ")}</span>
        <button
          type="button"
          className="reveal"
          title={`open in ${RUNS_IN[session.via ?? ""] ?? "its app"}`}
          onClick={() => {
            setTrouble(null);
            void onReveal().catch((failure) => setTrouble(String(failure)));
          }}
        >
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
            <path d="M6.5 3.5h6v6 M12.5 3.5 4 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      {trouble ? <p className="note">{trouble}</p> : null}
      {detail?.task ? (
        <p className="task" title={detail.task}>
          {detail.task}
        </p>
      ) : null}
      {detail === undefined ? <p className="empty">Reading the session.</p> : null}
      {detail === null ? <p className="empty">Nothing more is known of this session.</p> : null}
      {detail ? (
        <div className="split">
          <div className="side">
            {detail.tests ? (
              <button type="button" className="tests" title={detail.tests.command} onClick={() => detail.tests && setTrail([{ id: detail.tests.step, title: `run ${detail.tests.command}` }])}>
                <span className="result">
                  <span className={detail.tests.ok ? "state healthy" : "state failed"} />
                  {counted(detail.tests)}
                </span>
                <span className="ran">{detail.tests.command}</span>
              </button>
            ) : null}
            <div className="files">
              {detail.files.length === 0 ? <p className="none">Nothing changed yet.</p> : null}
              {detail.files.map((one) => (
                <button
                  type="button"
                  key={one.path}
                  className={one.path === picked ? "file on" : "file"}
                  title={one.path}
                  onClick={() => {
                    setPicked(one.path === picked ? null : one.path);
                    setTrail([]);
                  }}
                >
                  <span className="path">{one.path}</span>
                  <span className="plus">+{one.added}</span>
                  <span className="minus">−{one.removed}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="main">
            {here ? (
              <StepView
                key={`${here.agent ?? ""}:${here.id}`}
                place={here}
                load={load}
                live={live}
                onBack={() => setTrail((was) => was.slice(0, -1))}
                onOpen={open}
              />
            ) : (
              <>
                {!file && detail.said ? (
                  <button type="button" className={heard ? "said whole" : "said"} title="what it said last" onClick={() => setHeard((was) => !was)}>
                    <span className="words">{detail.said}</span>
                  </button>
                ) : null}
                <StepList steps={steps} onOpen={(one) => open({ id: one.id, title: titleOf(one) })} />
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
