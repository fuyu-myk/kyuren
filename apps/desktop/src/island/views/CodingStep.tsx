import type { Change, Step, StepDetail } from "@/island/steps";

function stateOf(ok: boolean | null): string {
  return ok === null ? "state running" : ok ? "state done" : "state failed";
}

/// Steps newest first, each opening to what it did.
export function StepList({ steps, onOpen }: { steps: Step[]; onOpen: (one: Step) => void }) {
  if (steps.length === 0) return <p className="note">No steps yet.</p>;
  return (
    <ol className="steps">
      {[...steps].reverse().map((one) => (
        <li key={one.id} role="button" tabIndex={-1} onClick={() => onOpen(one)}>
          <span className={stateOf(one.ok)} />
          <span className="what">
            <span className="verb">{one.verb}</span> {one.target}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Diff({ change }: { change: Change }) {
  return (
    <div className="change">
      <p className="change-head">
        <span className="path">{change.path}</span>
        <span className="plus">+{change.added}</span>
        <span className="minus">−{change.removed}</span>
      </p>
      <pre className="diff">
        {change.diff.map((line, at) => (
          <span key={at} className={line.kind === "+" ? "add" : line.kind === "-" ? "del" : line.kind === "@" ? "hunk" : ""}>
            {line.kind === "@" ? line.text : `${line.kind}${line.text}`}
            {"\n"}
          </span>
        ))}
      </pre>
    </div>
  );
}

function Printed({ detail, empty, onWhole }: { detail: StepDetail; empty: string | null; onWhole?: () => void }) {
  if (detail.output.length === 0) return empty ? <p className="note">{detail.ok === null ? "Still going." : empty}</p> : null;
  return (
    <>
      {detail.earlier > 0 && onWhole ? (
        <button type="button" className="earlier" onClick={onWhole}>
          Show all {detail.earlier + detail.output.length} lines
        </button>
      ) : null}
      {detail.earlier > 0 && !onWhole ? <p className="note">{detail.earlier} earlier lines</p> : null}
      <pre className="output">{detail.output.join("\n")}</pre>
    </>
  );
}

function Ended({ detail }: { detail: StepDetail & { kind: "run" } }) {
  if (detail.ok !== false) return null;
  return <p className="ended">{detail.code !== null ? `Ended with code ${detail.code}.` : "Failed."}</p>;
}

type Props = { detail: StepDetail; onOpen: (one: Step) => void; onWhole: () => void };

/// What a step was given and what came of it, as fits what it did: a command whole, and what it
/// printed, all of it on asking.
export function CodingStep({ detail, onOpen, onWhole }: Props) {
  switch (detail.kind) {
    case "run":
      return (
        <div className="step-detail">
          {detail.about ? <p className="about">{detail.about}</p> : null}
          <pre className="command">{detail.command}</pre>
          {detail.background ? <p className="note">It ran in the background, and what it printed went to a file of its own.</p> : null}
          <Ended detail={detail} />
          <Printed detail={detail} empty={detail.background ? null : "It printed nothing."} onWhole={onWhole} />
          {detail.changes.map((change) => (
            <Diff key={change.path} change={change} />
          ))}
        </div>
      );
    case "edit":
      return (
        <div className="step-detail">
          {detail.changes.map((change) => (
            <Diff key={change.path} change={change} />
          ))}
          <Printed detail={detail} empty={detail.changes.length === 0 ? "Nothing changed." : null} />
        </div>
      );
    case "read":
      return (
        <div className="step-detail">
          <p className="about">
            {detail.path}
            {detail.image ? ", a picture" : ""}
            {detail.from !== null && detail.lines !== null ? `, lines ${detail.from} to ${detail.from + Math.max(0, detail.lines - 1)}` : ""}
            {detail.of !== null ? ` of ${detail.of}` : ""}
          </p>
          {detail.content.length > 0 ? (
            <pre className="content">
              {detail.content.map((line, at) => (
                <span key={at}>
                  <span className="number">{(detail.from ?? 1) + at}</span>
                  {line}
                  {"\n"}
                </span>
              ))}
            </pre>
          ) : null}
          <Printed detail={detail} empty={null} />
        </div>
      );
    case "agent":
      return (
        <div className="step-detail">
          <p className="about">{detail.about}</p>
          {detail.prompt ? <pre className="prompt">{detail.prompt}</pre> : null}
          {detail.agent ? <StepList steps={detail.steps} onOpen={onOpen} /> : <p className="note">Its own steps are not written down where they can be read.</p>}
          <Printed detail={detail} empty={null} />
        </div>
      );
    case "other":
      return (
        <div className="step-detail">
          {detail.fields.length > 0 ? (
            <dl className="fields">
              {detail.fields.map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          <Printed detail={detail} empty="Nothing came back." />
        </div>
      );
  }
}
