import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { challenge, consentUrl, loopback } from "#connect/oauth/pkce.ts";
import type { Provider } from "#connect/oauth/provider.ts";
import { exchange, type Tokens } from "#connect/oauth/tokens.ts";
import { randomBytes } from "node:crypto";

const PATIENCE = 300_000;

const DONE = `<!doctype html><meta charset="utf-8"><title>Kyuren</title>
<body style="font:16px system-ui;background:#1e1e2e;color:#cdd6f4;display:grid;place-items:center;height:100vh;margin:0">
<p>Connected. You can close this tab and go back to Kyuren.</p>`;

const REFUSED = `<!doctype html><meta charset="utf-8"><title>Kyuren</title>
<body style="font:16px system-ui;background:#1e1e2e;color:#cdd6f4;display:grid;place-items:center;height:100vh;margin:0">
<p>Not connected. You can close this tab.</p>`;

export type Consent = {
  url: string;
  tokens: Promise<Tokens>;
};

/// Google sends the authorisation code back to a local address rather than to a server, so the
/// code never leaves the machine. The listener lives exactly as long as the one request it exists
/// to receive.
export async function consent(
  provider: Provider,
  clientId: string,
  clientSecret?: string,
): Promise<Consent> {
  const proof = challenge();
  const state = randomBytes(16).toString("base64url");

  let settle: (tokens: Tokens) => void;
  let fail: (reason: Error) => void;
  const tokens = new Promise<Tokens>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });

  const answer = (request: IncomingMessage, response: ServerResponse): void => {
    const asked = new URL(request.url ?? "/", "http://127.0.0.1");
    const code = asked.searchParams.get("code");
    const given = asked.searchParams.get("state");
    const refused = asked.searchParams.get("error");

    // A browser asks this address for more than the redirect: a favicon, a probe, a reload. None
    // of those are the answer, and treating the first of them as one ended the flow before the
    // user had even finished consenting.
    if (code === null && refused === null) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end(`waiting for ${provider.name}`);
      return;
    }

    const ok = code !== null && given === state;
    response.writeHead(ok ? 200 : 400, { "content-type": "text/html; charset=utf-8" });
    response.end(ok ? DONE : REFUSED);

    if (!ok) {
      // A mismatched state means the response did not come from the consent this process started.
      fail(new Error(
        refused ? `${provider.name} refused: ${refused}` : "the reply did not match the request",
      ));
      close();
      return;
    }

    exchange({
      provider,
      clientId,
      clientSecret,
      code,
      verifier: proof.verifier,
      redirect: loopback(listening, provider.host),
    }).then(settle, fail).finally(close);
  };

  const server = createServer(answer);
  let listening = 0;
  const open: Server[] = [server];
  function close(): void {
    for (const one of open.splice(0)) one.close();
  }

  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  listening = (server.address() as AddressInfo).port;

  // `localhost` resolves to both loopback addresses, and which one a browser picks is not ours to
  // decide. A redirect answered on one stack and listened for on the other is simply refused, so
  // when the redirect says localhost both are answered. A machine without IPv6 keeps the first.
  if (provider.host === "localhost") {
    const sixth = createServer(answer);
    await new Promise<void>((ready) => {
      sixth.once("error", () => ready());
      sixth.listen(listening, "::1", () => {
        open.push(sixth);
        ready();
      });
    });
  }

  const giveUp = setTimeout(() => {
    fail(new Error("nobody finished connecting"));
    close();
  }, PATIENCE);
  void tokens.catch(() => {}).finally(() => clearTimeout(giveUp));

  return {
    url: consentUrl({
      provider,
      clientId,
      redirect: loopback(listening, provider.host),
      challenge: proof.challenge,
      state,
    }),
    tokens,
  };
}
