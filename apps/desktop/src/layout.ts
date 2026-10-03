/// Arranging the island's tabs and widgets by dragging them: what is shown, in order, and what is
/// set aside.

/// Where a thing ends up when it is let go: at a place among those shown, or among the hidden.
/// `at` is its place in what is shown afterwards.
export function arranged<T>(shown: T[], dragged: T, into: "shown" | "hidden", at: number): T[] {
  const rest = shown.filter((one) => one !== dragged);
  if (into === "hidden") return rest;
  const place = Math.min(Math.max(0, at), rest.length);
  return [...rest.slice(0, place), dragged, ...rest.slice(place)];
}

/// The place a pointer stands for among things laid out in a row: after every one whose middle it
/// is past.
export function slot(x: number, boxes: Array<{ left: number; width: number }>): number {
  return boxes.filter((box) => x > box.left + box.width / 2).length;
}

/// A slot counted among things that include the one being dragged, as its place once it has
/// been taken out of where it was.
export function landing(at: number, was: number): number {
  return was >= 0 && at > was ? at - 1 : at;
}
