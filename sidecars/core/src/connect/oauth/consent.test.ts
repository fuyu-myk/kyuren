import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import { consent } from "#connect/oauth/consent.ts";
import type { Provider } from "#connect/oauth/provider.ts";

/// Stands in for the real token endpoint so the exchange runs without a grant and without network.
const exchanges = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ access_token: "access", refresh_token: "refresh", expires_in: 3600 }));
});
await new Promise<void>((ready) => exchanges.listen(0, "127.0.0.1", ready));
after(() => exchanges.close());

const stub: Provider = {
  name: "stub",
  authorize: "https://example.test/authorize",
  token: () => `http://127.0.0.1:${(exchanges.address() as AddressInfo).port}/token`,
  scopes: ["read"],
  host: "127.0.0.1",
  secret: false,
};

/// The same stub, reached the way Microsoft insists on being redirected.
const viaLocalhost: Provider = { ...stub, name: "stub-localhost", host: "localhost" };

function callbackFor(url: string, params: Record<string, string>): string {
  const redirect = new URL(new URL(url).searchParams.get("redirect_uri") ?? "");
  for (const [key, value] of Object.entries(params)) redirect.searchParams.set(key, value);
  return redirect.toString();
}

function stateOf(url: string): string {
  return new URL(url).searchParams.get("state") ?? "";
}

test("a request that is not the redirect does not end the flow", async () => {
  const flow = await consent(stub, "client");
  const redirect = new URL(new URL(flow.url).searchParams.get("redirect_uri") ?? "");

  const probe = await fetch(new URL("/favicon.ico", redirect).toString());
  assert.equal(probe.status, 404, "an unrelated request is answered, not acted on");

  const settled = await Promise.race([
    flow.tokens.then(() => "settled").catch(() => "settled"),
    new Promise((resolve) => setTimeout(() => resolve("waiting"), 150)),
  ]);
  assert.equal(settled, "waiting", "the flow must still be waiting for the real redirect");

  await fetch(callbackFor(flow.url, { code: "given", state: stateOf(flow.url) }));
  assert.equal((await flow.tokens).refresh, "refresh");
});

test("the real redirect completes the exchange", async () => {
  const flow = await consent(stub, "client");
  const answer = await fetch(callbackFor(flow.url, { code: "given", state: stateOf(flow.url) }));

  assert.equal(answer.status, 200);
  const tokens = await flow.tokens;
  assert.equal(tokens.access, "access");
  assert.ok(tokens.expiresAt > Date.now());
});

test("a reply carrying someone else's state is refused", async () => {
  const flow = await consent(stub, "client");
  await fetch(callbackFor(flow.url, { code: "given", state: "not-the-one-issued" }));
  await assert.rejects(flow.tokens, /did not match/);
});

test("a refusal from the service is reported as one", async () => {
  const flow = await consent(stub, "client");
  await fetch(callbackFor(flow.url, { error: "access_denied" }));
  await assert.rejects(flow.tokens, /stub refused: access_denied/);
});

test("a redirect to localhost is answered on both loopback stacks", async () => {
  const flow = await consent(viaLocalhost, "client");
  const redirect = new URL(new URL(flow.url).searchParams.get("redirect_uri") ?? "");

  assert.equal(redirect.hostname, "localhost", "Microsoft matches the host it was registered with");

  for (const host of ["127.0.0.1", "[::1]"]) {
    const probe = await fetch(`http://${host}:${redirect.port}/`);
    assert.equal(probe.status, 404, `${host} was not answered, so a browser choosing it would fail`);
  }

  await fetch(callbackFor(flow.url, { code: "given", state: stateOf(flow.url) }));
  assert.equal((await flow.tokens).refresh, "refresh");
});
