import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

type Rule = { trigger: { "url-filter": string }; action: { type: string } };

const RULES = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src-tauri/src/reader_rules.json"), "utf8"),
) as Rule[];

/// As WebKit matches a rule: against the address as parsed, and without regard to case.
const blocked = (url: string) => RULES.some((rule) => new RegExp(rule.trigger["url-filter"], "i").test(url));

test("what a page in the reader fetches for itself from this machine or its network is blocked", () => {
  for (const url of [
    "http://localhost:11434/api/tags",
    "http://LOCALHOST/",
    "http://localhost./x",
    "http://app.localhost:3000/",
    "http://printer.local/status",
    "http://router.lan:8080/",
    "http://nas.home.arpa/",
    "http://metadata.google.internal/computeMetadata/v1/",
    "http://router/",
    "http://user@printer.local/",
    "http://127.0.0.1:8080/x.png",
    "http://0.0.0.0:3000/",
    "http://10.0.0.1/",
    "http://172.16.0.1/",
    "http://172.31.255.255/",
    "http://192.168.1.1/admin",
    "http://169.254.169.254/latest/meta-data/",
    "http://100.100.100.100/",
    "http://[::1]:8080/",
    "http://[fd12::1]/",
    "ws://127.0.0.1:9222/devtools/browser",
    "wss://localhost:8443/socket",
  ]) {
    assert.ok(blocked(url), `${url} is let through`);
  }
});

test("what a page fetches from the public web is not blocked, whatever its names start with", () => {
  for (const url of [
    "https://example.com/",
    "https://www.wikipedia.org/wiki/Local",
    "https://fdic.gov/",
    "https://1270.example/",
    "https://172.32.0.1/",
    "https://100.128.0.1/",
    "https://example.com/page?next=http://localhost/",
    "https://cdn.example.com:8443/app.js",
    "https://foo.local.example.com/",
    "https://0.30000000000000004.com/",
    "https://10.example.com/",
    "https://127.example.net/x",
  ]) {
    assert.ok(!blocked(url), `${url} is blocked`);
  }
  for (const rule of RULES) assert.equal(rule.action.type, "block");
});

test("every rule is written in what WebKit can compile, so the reader is never left refusing everything", () => {
  for (const rule of RULES) {
    const filter = rule.trigger["url-filter"];
    for (const unsupported of ["|", "{", "\\d", "\\w", "\\s", "\\b", "(?"]) {
      assert.ok(!filter.includes(unsupported), `${filter} uses ${unsupported}`);
    }
  }
});
