import type { Snapshot } from "@/island/glance";

function percent(value: number): string {
  return `${Math.round(value)}%`;
}

const GB = 1_000_000_000;

/// How busy the machine is: processor, graphics, memory and the startup disk, each a bar.
export function SystemBars({ snapshot }: { snapshot: Snapshot | null }) {
  const rows: Array<{ name: string; value: number; kind: string; note?: string }> = [];
  if (snapshot) {
    rows.push({ name: "CPU", value: snapshot.cpu, kind: "cpu" });
    if (snapshot.gpu !== null) rows.push({ name: "GPU", value: snapshot.gpu, kind: "gpu" });
    rows.push({ name: "RAM", value: snapshot.ram, kind: "ram" });
    if (snapshot.disk && snapshot.disk.total > 0) {
      rows.push({
        name: "Disk",
        value: (snapshot.disk.used / snapshot.disk.total) * 100,
        kind: "disk",
        note: `${Math.round(snapshot.disk.used / GB)} of ${Math.round(snapshot.disk.total / GB)} GB`,
      });
    }
  }
  return (
    <div className="widget bars">
      {rows.length === 0 ? <p className="empty">Reading the machine.</p> : null}
      {rows.map((row) => (
        <div key={row.kind} className="bar">
          <div className="label">
            <span>
              {row.name}
              {row.note ? <span className="note"> {row.note}</span> : null}
            </span>
            <span>{percent(row.value)}</span>
          </div>
          <div className="track">
            <div className={`fill ${row.kind}`} style={{ width: `${Math.min(100, Math.max(0, row.value))}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
