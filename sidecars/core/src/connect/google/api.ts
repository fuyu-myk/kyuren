import { secretFor } from "#connect/secrets.ts";
import { GOOGLE } from "#connect/google/provider.ts";
import { expired, refresh, type Tokens } from "#connect/oauth/tokens.ts";

export type Credentials = {
  clientId: string;
  clientSecret: string;
  refresh: string;
};

/// One keychain entry holds the whole connection: the client the user registered and the grant
/// they gave it. Splitting them would let half a connection survive a disconnect.
export function credentials(): Credentials | undefined {
  const held = secretFor("google");
  if (!held) return undefined;

  try {
    const parsed = JSON.parse(held) as Partial<Credentials>;
    if (!parsed.clientId || !parsed.clientSecret || !parsed.refresh) return undefined;
    return parsed as Credentials;
  } catch {
    return undefined;
  }
}

export function connected(): boolean {
  return credentials() !== undefined;
}

let current: Tokens | undefined;

/// Access tokens last an hour and are not worth storing. The refresh token is the connection; this
/// is just the part of it that is currently usable.
async function access(): Promise<string> {
  const held = credentials();
  if (!held) throw new Error("google is not connected");

  if (!current || expired(current)) {
    current = await refresh({
      provider: GOOGLE,
      clientId: held.clientId,
      clientSecret: held.clientSecret,
      refresh: held.refresh,
    });
  }

  return current.access;
}

export function forgetAccess(): void {
  current = undefined;
}

export async function google(url: string): Promise<Record<string, unknown>> {
  const token = await access();
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });

  const text = await response.text();
  if (!response.ok) {
    if (response.status === 401) {
      // The cached access token is the likeliest cause, and keeping it would fail every retry.
      forgetAccess();
    }
    let said = text.slice(0, 200);
    try {
      said = ((JSON.parse(text) as { error?: { message?: string } }).error?.message) ?? said;
    } catch {
      // Not JSON, so the truncated body is the best account available.
    }
    throw new Error(`google ${response.status}: ${said}`);
  }

  return JSON.parse(text) as Record<string, unknown>;
}
