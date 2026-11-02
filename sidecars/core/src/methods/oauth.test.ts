import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import { test, type TestContext } from "node:test";
import { forgetAccess } from "#connect/google/api.ts";
import { forget, remember } from "#connect/secrets.ts";
import { oauthHandlers } from "#methods/oauth.ts";

const transport = { send: () => undefined, listen: () => undefined };

const HELD = { clientId: "held-client", clientSecret: "held-secret", refresh: "held-refresh" };

/// A stand-in for Google's token address, let go when the test ends however it ends.
async function tokenService(context: TestContext, answer: (response: ServerResponse) => void): Promise<void> {
  const server = createServer((_request, response) => answer(response));
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  context.after(() => {
    server.closeAllConnections();
    server.close();
  });
  process.env.KYUREN_GOOGLE_TOKEN_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}/token`;
}

function withGoogle(held: object | undefined): void {
  forgetAccess();
  if (held) remember("google", JSON.stringify(held));
  else forget("google");
}

test("connecting again with nothing typed uses the client already held", async () => {
  withGoogle(HELD);
  const { url } = await oauthHandlers(transport)["oauth.connect"]({ service: "google" });
  const asked = new URL(url);
  assert.equal(asked.searchParams.get("client_id"), "held-client");

  // Refused in the browser, so the listener the consent opened is let go.
  await fetch(`${asked.searchParams.get("redirect_uri")}?error=access_denied`);
  withGoogle(undefined);
});

test("with nothing typed and nothing held, a client id is still asked for", async () => {
  withGoogle(undefined);
  await assert.rejects(oauthHandlers(transport)["oauth.connect"]({ service: "google" }), /google needs a client id/);
});

test("a grant the service refuses is said to have expired", async (context) => {
  await tokenService(context, (response) => {
    response.writeHead(400, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "invalid_grant" }));
  });
  withGoogle(HELD);
  assert.deepEqual(await oauthHandlers(transport)["oauth.expired"](), { names: ["google"] });
  withGoogle(undefined);
});

test("a grant that cannot be checked, or that still works, is not said to have expired", async (context) => {
  await tokenService(context, (response) => {
    response.writeHead(503, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "temporarily_unavailable" }));
  });
  withGoogle(HELD);
  assert.deepEqual(await oauthHandlers(transport)["oauth.expired"](), { names: [] }, "an outage is not the user's to fix");

  await tokenService(context, (response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ access_token: "fresh", expires_in: 3600 }));
  });
  withGoogle(HELD);
  assert.deepEqual(await oauthHandlers(transport)["oauth.expired"](), { names: [] });
  withGoogle(undefined);
});

test("a service not connected is not checked", async () => {
  withGoogle(undefined);
  assert.deepEqual(await oauthHandlers(transport)["oauth.expired"](), { names: [] });
});
