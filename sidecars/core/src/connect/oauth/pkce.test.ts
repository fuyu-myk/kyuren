import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { GOOGLE } from "#connect/google/provider.ts";
import { MICROSOFT } from "#connect/microsoft/provider.ts";
import { challenge, consentUrl, loopback } from "#connect/oauth/pkce.ts";

test("the challenge is the hash of the verifier, not the verifier", () => {
  const made = challenge();
  assert.notEqual(made.verifier, made.challenge);
  assert.equal(made.challenge, createHash("sha256").update(made.verifier).digest("base64url"));
});

test("two challenges are never the same", () => {
  assert.notEqual(challenge().verifier, challenge().verifier);
});

test("a provider's extra parameters reach the consent address", () => {
  const url = new URL(consentUrl({
    provider: GOOGLE, clientId: "cid", redirect: loopback(1234), challenge: "abc", state: "xyz",
  }));

  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("code_challenge"), "abc");
  assert.equal(url.searchParams.get("state"), "xyz");
});

test("only read access is asked for, from either service", () => {
  for (const provider of [GOOGLE, MICROSOFT]) {
    const scope = new URL(consentUrl({
      provider, clientId: "cid", redirect: loopback(1), challenge: "c", state: "s",
    })).searchParams.get("scope") ?? "";

    const asked = scope.split(" ").filter((one) => one !== "offline_access");
    assert.ok(asked.length > 0, `${provider.name} asked for nothing`);
    assert.ok(
      asked.every((one) => one.toLowerCase().includes("read")),
      `${provider.name} asked for more than reading: ${scope}`,
    );
  }
});

test("a refresh token is asked for, or the connection lasts an hour", () => {
  const google = new URL(consentUrl({
    provider: GOOGLE, clientId: "c", redirect: loopback(1), challenge: "c", state: "s",
  }));
  assert.equal(google.searchParams.get("access_type"), "offline");

  const microsoft = new URL(consentUrl({
    provider: MICROSOFT, clientId: "c", redirect: loopback(1), challenge: "c", state: "s",
  }));
  assert.ok((microsoft.searchParams.get("scope") ?? "").includes("offline_access"));
});

test("the redirect never leaves the machine", () => {
  assert.equal(loopback(8080), "http://127.0.0.1:8080");
  assert.equal(new URL(loopback(8080)).hostname, "127.0.0.1");
});
