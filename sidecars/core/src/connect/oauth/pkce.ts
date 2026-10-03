import { createHash, randomBytes } from "node:crypto";
import type { Provider } from "#connect/oauth/provider.ts";

export type Challenge = {
  verifier: string;
  challenge: string;
};

/// Proof key for code exchange. An installed application cannot keep a secret, so the code is
/// bound to a value only this process knows rather than to a secret anyone can read out of it.
export function challenge(): Challenge {
  const verifier = randomBytes(48).toString("base64url");
  return {
    verifier,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
  };
}

export function consentUrl(options: {
  provider: Provider;
  clientId: string;
  redirect: string;
  challenge: string;
  state: string;
}): string {
  const url = new URL(options.provider.authorize);
  url.searchParams.set("client_id", options.clientId);
  url.searchParams.set("redirect_uri", options.redirect);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", options.provider.scopes.join(" "));
  url.searchParams.set("code_challenge", options.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", options.state);
  for (const [key, value] of Object.entries(options.provider.extra ?? {})) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

/// Only ever a loopback address. A redirect that left the machine could carry the code with it.
export function loopback(port: number, host: "localhost" | "127.0.0.1" = "127.0.0.1"): string {
  return `http://${host}:${port}`;
}
