import type { Provider } from "#connect/oauth/provider.ts";

export type Tokens = {
  access: string;
  refresh?: string;
  expiresAt: number;
};

type Granted = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

/// A minute of slack. A token that expires while a request is in flight reads as a failure the
/// user cannot act on, and refreshing early costs nothing.
const EARLY = 60_000;

export function expired(tokens: Tokens, now: number = Date.now()): boolean {
  return tokens.expiresAt - EARLY <= now;
}

async function post(provider: Provider, body: Record<string, string>): Promise<Tokens> {
  const response = await fetch(provider.token(), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(20_000),
  });

  const granted = (await response.json()) as Granted;
  if (!response.ok || !granted.access_token) {
    throw new Error(explain(granted, response.status));
  }

  return {
    access: granted.access_token,
    refresh: granted.refresh_token,
    expiresAt: Date.now() + (granted.expires_in ?? 3600) * 1000,
  };
}

/// A grant the user withdrew, or one that expired, is the one failure they can actually act on.
/// Every service says so with the same code, inside a message that otherwise reads as a transport
/// error. The service is not named here because whatever reports this already names it.
function explain(granted: Granted, status: number): string {
  if (granted.error === "invalid_grant") {
    return "the grant was withdrawn or has expired, so connect it again";
  }

  const said = [granted.error, granted.error_description].filter(Boolean).join(": ");
  return `could not be authorised: ${said || `HTTP ${status}`}`;
}

function withSecret(
  provider: Provider,
  clientSecret: string | undefined,
  body: Record<string, string>,
): Record<string, string> {
  return provider.secret && clientSecret ? { ...body, client_secret: clientSecret } : body;
}

export function exchange(options: {
  provider: Provider;
  clientId: string;
  clientSecret?: string;
  code: string;
  verifier: string;
  redirect: string;
}): Promise<Tokens> {
  return post(options.provider, withSecret(options.provider, options.clientSecret, {
    client_id: options.clientId,
    code: options.code,
    code_verifier: options.verifier,
    redirect_uri: options.redirect,
    grant_type: "authorization_code",
  }));
}

export function refresh(options: {
  provider: Provider;
  clientId: string;
  clientSecret?: string;
  refresh: string;
}): Promise<Tokens> {
  return post(options.provider, withSecret(options.provider, options.clientSecret, {
    client_id: options.clientId,
    refresh_token: options.refresh,
    grant_type: "refresh_token",
  }));
}
