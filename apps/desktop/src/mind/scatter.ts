/// A settled number between nothing and one for a given name.
///
/// Taken from the name rather than kept as state, so an orb sits in the same place and a link
/// bends the same way every time the mind is read again.
export function scatter(text: string): number {
  let held = 2166136261;
  for (let at = 0; at < text.length; at += 1) {
    held = Math.imul(held ^ text.charCodeAt(at), 16777619);
  }
  return (held >>> 0) / 4294967296;
}
