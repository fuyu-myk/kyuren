import { secretFor } from "#connect/secrets.ts";
import { MICROSOFT } from "#connect/microsoft/provider.ts";
import { expired, refresh, type Tokens } from "#connect/oauth/tokens.ts";

export const GRAPH = process.env.KYUREN_GRAPH_URL ?? "https://graph.microsoft.com/v1.0";

export type Credentials = {
  clientId: string;
  refresh: string;
};

export function credentials(): Credentials | undefined {
  const held = secretFor("microsoft");
  if (!held) return undefined;

  try {
    const parsed = JSON.parse(held) as Partial<Credentials>;
    if (!parsed.clientId || !parsed.refresh) return undefined;
    return parsed as Credentials;
  } catch {
    return undefined;
  }
}

export function connected(): boolean {
  return credentials() !== undefined;
}

let current: Tokens | undefined;

export function forgetAccess(): void {
  current = undefined;
}

async function access(): Promise<string> {
  const held = credentials();
  if (!held) throw new Error("microsoft is not connected");

  if (!current || expired(current)) {
    current = await refresh({ provider: MICROSOFT, clientId: held.clientId, refresh: held.refresh });
  }

  return current.access;
}

export async function graph(path: string): Promise<Record<string, unknown>> {
  const token = await access();
  const response = await fetch(`${GRAPH}${path}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });

  const text = await response.text();
  if (!response.ok) {
    if (response.status === 401) {
      forgetAccess();
    }
    let said = text.slice(0, 200);
    try {
      said = ((JSON.parse(text) as { error?: { message?: string } }).error?.message) ?? said;
    } catch {
      // Not JSON, so the truncated body is the best account available.
    }
    throw new Error(`microsoft ${response.status}: ${said}`);
  }

  return JSON.parse(text) as Record<string, unknown>;
}
