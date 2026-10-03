import assert from "node:assert/strict";
import { test } from "node:test";
import { expired, type Tokens } from "#connect/oauth/tokens.ts";

const at = 1_000_000_000_000;

function tokens(expiresAt: number): Tokens {
  return { access: "a", refresh: "r", expiresAt };
}

test("a token well in the future is usable", () => {
  assert.equal(expired(tokens(at + 3_600_000), at), false);
});

test("a token already past is expired", () => {
  assert.equal(expired(tokens(at - 1), at), true);
});

test("a token about to expire is treated as expired", () => {
  assert.equal(expired(tokens(at + 30_000), at), true,
    "refreshing early costs nothing, failing mid-request costs the answer");
});

test("a withdrawn grant is reported as something to act on", async () => {
  const { createServer } = await import("node:http");
  const { refresh } = await import("#connect/oauth/tokens.ts");

  const refusing = createServer((_request, response) => {
    response.writeHead(400, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "invalid_grant", error_description: "Bad Request" }));
  });
  await new Promise<void>((ready) => refusing.listen(0, "127.0.0.1", ready));
  const port = (refusing.address() as { port: number }).port;

  const provider = {
    name: "google",
    authorize: "https://example.test/a",
    token: () => `http://127.0.0.1:${port}/token`,
    scopes: ["read"],
    host: "127.0.0.1" as const,
    secret: false,
  };

  await assert.rejects(
    refresh({ provider, clientId: "c", refresh: "withdrawn" }),
    /^Error: the grant was withdrawn or has expired, so connect it again$/,
    "Bad Request alone tells the user nothing they can do",
  );
  refusing.close();
});
