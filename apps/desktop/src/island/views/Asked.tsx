import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { answeredFor, boundsOf, contentFor, nextOpen, pickedOf, pressed, secondsLeft, type AgentAsk, type Chosen, type Decision, type Extra, type Field } from "@/island/asks";
import { BackIcon } from "@/island/icons";
import { harnessName } from "@/island/views/Coding";
import { Markdown } from "@/Markdown";

type Props = {
  ask: AgentAsk;
  now: number;
  /// The island is open and grown, so the question can be seen.
  shown: boolean;
  onAnswer: (decision: Decision, extra?: Extra) => void;
  onBack: () => void;
  /// The keyboard is wanted, and then no longer.
  onReach: () => void;
  onLeave: () => void;
};

/// A click this soon after the question came into view was aimed at what was there before.
const STEADY = 450;

const TITLES: Record<AgentAsk["kind"], string> = {
  permission: "a permission",
  choice: "questions to choose among",
  plan: "a plan to approve",
  edit: "an edit",
  form: "a form",
};

/// One question opened whole in place of the list: what the agent asks, all of it, and the answers
/// it can be given, with handing it back to be asked in the agent's own way always among them.
export function Asked({ ask, now, shown, onAnswer, onBack, onReach, onLeave }: Props) {
  // Kept open through a fold, the question comes back into view under a cursor already moving, and
  // the guard is set before it is drawn, not a frame after.
  const shownAt = useRef(Date.now());
  useLayoutEffect(() => {
    shownAt.current = Date.now();
  }, [ask.id, shown]);
  const steady = (act: () => void) => () => {
    if (Date.now() - shownAt.current >= STEADY) act();
  };

  return (
    <div className="view asked">
      <div className="head">
        <button type="button" className="back" title="back to everything waiting" onClick={onBack}>
          <BackIcon />
        </button>
        <span className="what">
          <strong>{harnessName(ask.harness)}</strong> in {ask.project} has {TITLES[ask.kind]}
        </span>
        <span className="left" title="when it asks in its own window instead">{secondsLeft(ask, now)}s</span>
      </div>
      {ask.kind === "choice" ? <Choosing ask={ask} steady={steady} onAnswer={onAnswer} onReach={onReach} onLeave={onLeave} /> : null}
      {ask.kind === "plan" ? <Planned ask={ask} steady={steady} onAnswer={onAnswer} /> : null}
      {ask.kind === "edit" ? <Edited ask={ask} steady={steady} onAnswer={onAnswer} /> : null}
      {ask.kind === "form" ? <Filled ask={ask} steady={steady} onAnswer={onAnswer} onReach={onReach} onLeave={onLeave} /> : null}
    </div>
  );
}

/// The keyboard is wanted, and then no longer.
type Keyboard = { onReach: () => void; onLeave: () => void };

type Answering<K extends AgentAsk["kind"]> = {
  ask: Extract<AgentAsk, { kind: K }>;
  steady: (act: () => void) => () => void;
  onAnswer: (decision: Decision, extra?: Extra) => void;
};

function Back({ steady, onAnswer }: Pick<Answering<AgentAsk["kind"]>, "steady" | "onAnswer">) {
  return (
    <button type="button" onClick={steady(() => onAnswer("ask"))}>
      ask there
    </button>
  );
}

/// Questions asked together come one at a time, as Claude Code's own picker shows them: the island
/// has room for one, and a second below the first went unseen while the answer waited on it. Their
/// topics say which have their answer and go to any; a pick where only one may be goes on to the
/// next. Each has Other too, as Claude Code's own does, for an answer typed in place of the options.
function Choosing({ ask, steady, onAnswer, onReach, onLeave }: Answering<"choice"> & Keyboard) {
  const [chosen, setChosen] = useState<Chosen>({ picked: {}, typed: {} });
  const [at, setAt] = useState(0);
  // The box going away, answered, handed back or out of time, takes no blur with it, so while it
  // holds the keyboard it hands it back here. Only its own: another pane may be typed into.
  const holding = useRef<(() => void) | null>(null);
  useEffect(() => () => holding.current?.(), []);
  const one = ask.questions[at] ?? ask.questions[0];
  if (!one) return null;
  const answered = answeredFor(ask.questions, chosen);
  const next = nextOpen(ask.questions, chosen, at);
  const typing = Object.hasOwn(chosen.typed, one.question);
  const send = steady(() => {
    if (answered) onAnswer("allow", { picked: answered.picked, ...(Object.keys(answered.other).length > 0 ? { other: answered.other } : {}) });
  });
  const press = (label: string | undefined) => {
    const made = pressed(chosen, one, label);
    setChosen(made);
    const after = label === undefined || one.multiSelect ? undefined : nextOpen(ask.questions, made, at);
    if (after !== undefined) setAt(after);
  };
  return (
    <>
      <div className="whole" key={at}>
        {ask.questions.length > 1 ? (
          <div className="steps">
            {ask.questions.map((each, place) => (
              <button
                type="button"
                key={each.question}
                className={[place === at ? "on" : "", answeredFor([each], chosen) ? "done" : ""].filter(Boolean).join(" ") || undefined}
                aria-current={place === at ? "step" : undefined}
                onClick={() => setAt(place)}
              >
                {each.header || `question ${place + 1}`}
              </button>
            ))}
          </div>
        ) : null}
        <div className="question">
          {ask.questions.length === 1 && one.header ? <span className="topic">{one.header}</span> : null}
          <p className="asks">{one.question}</p>
          <div className="options">
            {one.options.map((option) => {
              const on = pickedOf(chosen.picked, one).includes(option.label);
              return (
                <button type="button" key={option.label} className={on ? "option on" : "option"} aria-pressed={on} onClick={() => press(option.label)}>
                  <strong>{option.label}</strong>
                  {option.description ? <span>{option.description}</span> : null}
                </button>
              );
            })}
            <button type="button" className={typing ? "option on" : "option"} aria-pressed={typing} onClick={() => press(undefined)}>
              <strong>Other</strong>
              <span>an answer of your own</span>
            </button>
          </div>
          {typing ? (
            <input
              className="composer other"
              autoFocus
              maxLength={1_000}
              spellCheck={false}
              placeholder="your answer"
              value={chosen.typed[one.question] ?? ""}
              onPointerDown={onReach}
              onFocus={() => {
                holding.current = onLeave;
                onReach();
              }}
              onBlur={() => {
                holding.current = null;
                onLeave();
              }}
              onChange={(event) => setChosen((was) => ({ ...was, typed: { ...was.typed, [one.question]: event.target.value } }))}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                if (answered) send();
                else if (next !== undefined && answeredFor([one], chosen)) setAt(next);
              }}
            />
          ) : null}
          {one.multiSelect ? <span className="hint">as many as apply</span> : null}
        </div>
      </div>
      <div className="foot">
        <Back steady={steady} onAnswer={onAnswer} />
        {answered || next === undefined ? (
          <button type="button" className="allow" disabled={!answered} onClick={send}>
            answer
          </button>
        ) : (
          <button type="button" className="allow" onClick={() => setAt(next)}>
            next
          </button>
        )}
      </div>
    </>
  );
}

function Planned({ ask, steady, onAnswer }: Answering<"plan">) {
  // Drawn once, not again with each second counted down.
  const plan = useMemo(() => <Markdown text={ask.plan} addresses />, [ask.plan]);
  return (
    <>
      <div className="whole plan">{plan}</div>
      <div className="foot">
        <Back steady={steady} onAnswer={onAnswer} />
        <button type="button" className="deny" onClick={steady(() => onAnswer("deny"))}>
          keep planning
        </button>
        <button type="button" className="allow" onClick={steady(() => onAnswer("allow", { mode: "default" }))}>
          approve, ask before edits
        </button>
        <button type="button" className="allow" onClick={steady(() => onAnswer("allow", { mode: "acceptEdits" }))}>
          approve, accept edits
        </button>
      </div>
    </>
  );
}

function Edited({ ask, steady, onAnswer }: Answering<"edit">) {
  const how = ask.fresh ? "a new file" : ask.whole ? "the whole file, as it will be" : ask.every ? "wherever the old text is found" : null;
  // Drawn once, not again with each second counted down.
  const diff = useMemo(
    () =>
      ask.diff.map((line, at) => (
        <span key={at} className={line.kind === "+" ? "add" : line.kind === "-" ? "del" : line.kind === "@" ? "hunk" : ""}>
          {line.kind === "@" ? line.text : `${line.kind}${line.text}`}
          {"\n"}
        </span>
      )),
    [ask.diff],
  );
  return (
    <>
      <p className="change-head">
        <span className="path">{ask.path}</span>
        <span className="plus">+{ask.added}</span>
        <span className="minus">−{ask.removed}</span>
        {how ? <span className="how">{how}</span> : null}
      </p>
      <pre className="whole diff">{diff}</pre>
      <div className="foot">
        <Back steady={steady} onAnswer={onAnswer} />
        <button type="button" className="deny" onClick={steady(() => onAnswer("deny"))}>
          deny
        </button>
        <button type="button" className="allow" onClick={steady(() => onAnswer("allow"))}>
          allow
        </button>
      </div>
    </>
  );
}

function Titled({ field }: { field: Field }) {
  const bounds = boundsOf(field);
  return (
    <>
      <span className="title">
        {field.title}
        {field.required ? null : <span className="hint"> optional</span>}
        {bounds ? <span className="hint">, {bounds}</span> : null}
      </span>
      {field.about ? <span className="hint">{field.about}</span> : null}
    </>
  );
}

function Filled({ ask, steady, onAnswer, onReach, onLeave }: Answering<"form"> & Keyboard) {
  const [typed, setTyped] = useState<Record<string, string | boolean>>({});
  // The form going away, answered, handed back or out of time, takes no blur with it, so a field
  // holding the keyboard hands it back here. Only its own: another pane may be typed into.
  const holding = useRef<(() => void) | null>(null);
  useEffect(() => () => holding.current?.(), []);
  const read = contentFor(ask.fields, typed);
  const set = (field: Field, value: string | boolean) => setTyped((was) => ({ ...was, [field.name]: value }));
  return (
    <>
      <div className="whole form">
        <p className="asks">
          <strong>{ask.server}</strong> asks: {ask.message}
        </p>
        {ask.fields.map((field) => {
          const values: Array<string | boolean> = field.type === "boolean" ? [true, false] : field.choices;
          return values.length > 0 ? (
            // Not a label, which passes a click anywhere on it to its first button: a pick never made.
            <div key={field.name} className="field" role="group" aria-label={field.title}>
              <Titled field={field} />
              <span className="options">
                {values.map((value) => (
                  <button type="button" key={String(value)} className={typed[field.name] === value ? "option on" : "option"} aria-pressed={typed[field.name] === value} onClick={() => set(field, value)}>
                    {value === true ? "yes" : value === false ? "no" : value}
                  </button>
                ))}
              </span>
            </div>
          ) : (
            <label key={field.name} className="field">
              <Titled field={field} />
              <input
                className="composer"
                inputMode={field.type === "string" ? "text" : "decimal"}
                spellCheck={false}
                value={typeof typed[field.name] === "string" ? (typed[field.name] as string) : ""}
                onPointerDown={onReach}
                onFocus={() => {
                  holding.current = onLeave;
                  onReach();
                }}
                onBlur={() => {
                  holding.current = null;
                  onLeave();
                }}
                onChange={(event) => set(field, event.target.value)}
              />
            </label>
          );
        })}
        {"wrong" in read && read.wrong.length > 0 ? <p className="said trouble">Not as asked: {read.wrong.join(", ")}</p> : null}
      </div>
      <div className="foot">
        <Back steady={steady} onAnswer={onAnswer} />
        <button type="button" className="deny" onClick={steady(() => onAnswer("deny"))}>
          decline
        </button>
        <button type="button" className="allow" disabled={!("content" in read)} onClick={steady(() => "content" in read && onAnswer("allow", { content: read.content }))}>
          send
        </button>
      </div>
    </>
  );
}
