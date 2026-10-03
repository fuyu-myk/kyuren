import assert from "node:assert/strict";
import { test } from "node:test";
import { forget, remember } from "#connect/secrets.ts";
import { cloudConfigured } from "#model/providers.ts";

test("a key held in the keychain is what makes the cloud available", () => {
  const had = process.env.ANTHROPIC_API_KEY;
  const token = process.env.ANTHROPIC_AUTH_TOKEN;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  try {
    forget("anthropic");
    assert.equal(cloudConfigured(), false, "no key, no cloud");
    remember("anthropic", "held-by-the-keychain");
    assert.equal(cloudConfigured(), true);
  } finally {
    forget("anthropic");
    if (had !== undefined) process.env.ANTHROPIC_API_KEY = had;
    if (token !== undefined) process.env.ANTHROPIC_AUTH_TOKEN = token;
  }
});
