/// A repair under way: the name it was started under, and whether it has been asked to stop.
export type Repair = { id: string; stopped: boolean };

/// Repairs under way, by the playbook each repairs, kept apart from the page that started them, so
/// leaving that page and coming back finds a repair still running and still stoppable.
const under = new Map<string, Repair>();
const told = new Set<() => void>();

function changed(): void {
  for (const tell of told) tell();
}

export function repairing(name: string): Repair | undefined {
  return under.get(name);
}

export function began(name: string, id: string): void {
  under.set(name, { id, stopped: false });
  changed();
}

/// Marked as stopped before it is stopped, so the stop is not taken for trouble when it lands.
export function stopping(name: string): Repair | undefined {
  const going = under.get(name);
  if (!going) return undefined;
  const stopped = { ...going, stopped: true };
  under.set(name, stopped);
  changed();
  return stopped;
}

/// Over, however it went. A later repair of the same playbook is left alone.
export function ended(name: string, id: string): void {
  if (under.get(name)?.id !== id) return;
  under.delete(name);
  changed();
}

export function watchRepairs(tell: () => void): () => void {
  told.add(tell);
  return () => told.delete(tell);
}
