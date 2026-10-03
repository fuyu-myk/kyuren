/// Credentials live in the system keychain and are handed to this process when it starts and
/// whenever one changes. Nothing here writes them anywhere, so losing the process loses the copy.
const held = new Map<string, string>();

export function remember(name: string, secret: string): void {
  held.set(name, secret);
}

export function forget(name: string): void {
  held.delete(name);
}

export function secretFor(name: string): string | undefined {
  return held.get(name);
}

export function connected(): string[] {
  return [...held.keys()].sort();
}
