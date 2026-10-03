/// The display name alone when there is one. A brief that reads out angle brackets and domains is
/// unpleasant to listen to, and every mail service states the sender the same way.
export function sender(from: string | undefined): string | undefined {
  if (!from) return undefined;
  const named = /^\s*"?([^"<]+?)"?\s*<.+>\s*$/.exec(from);
  return (named?.[1] ?? from).trim() || undefined;
}
