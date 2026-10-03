/// Sends a stream of values one at a time, as fast as each send allows: a value arriving while one
/// is being sent waits, replaced by any that comes after it, and goes once the send before it has
/// finished, so the last one always lands and sends never pile up behind a slow receiver.
export function pacer<T>(send: (value: T) => Promise<unknown>): (value: T) => void {
  let busy = false;
  let waiting: { value: T } | null = null;
  const go = (value: T): void => {
    busy = true;
    void send(value)
      .catch(() => undefined)
      .finally(() => {
        busy = false;
        const next = waiting;
        waiting = null;
        if (next) go(next.value);
      });
  };
  return (value: T) => {
    if (busy) waiting = { value };
    else go(value);
  };
}
