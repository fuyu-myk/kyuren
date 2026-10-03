/// Runs work a few at a time, keeping the order of the answers.
///
/// Forty repositories is forty pairs of processes. Started all at once they fight each other for
/// the disk and the machine stops answering; started one at a time the board takes a second to
/// appear. A handful at a time is neither.
export async function inHandfuls<T, R>(
  items: T[],
  many: number,
  each: (item: T) => Promise<R>,
): Promise<R[]> {
  const found: R[] = new Array<R>(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (true) {
      const at = next;
      next += 1;
      if (at >= items.length) return;
      found[at] = await each(items[at]!);
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(many, items.length)) }, () => worker()),
  );
  return found;
}
