import type { Firing } from "@/ambient";
import { clockOf, sayingOf } from "@/news";

/// What the presence rules noticed lately, and the scheduled runs that finished.
export function Notices({ notices }: { notices: Firing[] }) {
  return (
    <div className="view list">
      {notices.length === 0 ? <p className="empty">Nothing noticed lately.</p> : null}
      {notices.slice(0, 7).map((one) => (
        <div key={`${one.rule}-${one.at}`} className="row">
          <span className="when">{clockOf(one)}</span>
          <span className="what">
            {one.title}
            <span className="target">{sayingOf(one)}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
