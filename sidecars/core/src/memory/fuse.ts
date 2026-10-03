export type Ranked = {
  id: string;
  score: number;
};

/// Reciprocal rank fusion.
///
/// Two searches that disagree about what a score means can still agree about order, so only order
/// is used. Something both searches place near the top beats something one of them adores and the
/// other has never heard of, which is what stops a single strong keyword match from burying an
/// answer that is merely about the right thing.
const SOFTEN = 60;

export function fuse(...lists: Ranked[][]): Ranked[] {
  const total = new Map<string, number>();

  for (const list of lists) {
    list.forEach((entry, index) => {
      total.set(entry.id, (total.get(entry.id) ?? 0) + 1 / (SOFTEN + index + 1));
    });
  }

  return [...total]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let left = 0;
  let right = 0;

  for (let i = 0; i < a.length && i < b.length; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    left += x * x;
    right += y * y;
  }

  const size = Math.sqrt(left) * Math.sqrt(right);
  return size === 0 ? 0 : dot / size;
}
