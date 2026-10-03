export type Step = { id: string; step: string; tool: string; target: string; ok?: boolean; at: number };

/// What Kyuren is doing, a step at a time, newest first.
export function Work({ steps }: { steps: Step[] }) {
  return (
    <div className="view list">
      {steps.length === 0 ? <p className="empty">Nothing is running.</p> : null}
      {steps.slice(0, 7).map((one) => (
        <div key={one.step} className="row step">
          <span className={one.ok === undefined ? "state running" : one.ok ? "state done" : "state failed"} />
          <span className="what">
            <strong>{one.tool}</strong>
            <span className="target">{one.target}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
