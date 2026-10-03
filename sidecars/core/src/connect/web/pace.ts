/// Work done one at a time, a breath apart. A search engine's page is meant for a person, and it
/// treats a burst of questions as no person: three sub-runs searching at once were a burst, and
/// the engine answered every one after the first few with a challenge.
export function spaced(gap: number): <T>(work: () => Promise<T>) => Promise<T> {
  let last: Promise<unknown> = Promise.resolve();
  let doneAt = 0;
  return (work) => {
    const turn = last.then(async () => {
      const wait = doneAt + gap - Date.now();
      if (wait > 0) await new Promise((ready) => setTimeout(ready, wait));
      try {
        return await work();
      } finally {
        doneAt = Date.now();
      }
    });
    last = turn.catch(() => undefined);
    return turn;
  };
}
