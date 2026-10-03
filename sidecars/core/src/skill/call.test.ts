import assert from "node:assert/strict";
import { test } from "node:test";
import { requestFor, scrub } from "#skill/call.ts";
import type { Skill } from "#skill/shape.ts";

function skill(changes: Partial<Skill> = {}): Skill {
  return {
    id: "one",
    name: "weather_now",
    about: "The current weather in a named city.",
    method: "GET",
    url: "https://api.example.com/v1/weather/{city}",
    parameters: [
      { name: "city", in: "path", kind: "string", required: true, about: "the city" },
      { name: "units", in: "query", kind: "string", required: false, about: "metric or imperial" },
    ],
    headers: { accept: "application/json" },
    auth: { mode: "none" },
    reads: "json",
    state: "approved",
    drafted: 1,
    ...changes,
  };
}

function built(one: ReturnType<typeof requestFor>) {
  assert.ok("request" in one, `expected a request, got ${JSON.stringify(one)}`);
  return one.request;
}

test("a path and a query are filled in", () => {
  const request = built(requestFor(skill(), { city: "Singapore", units: "metric" }));
  assert.equal(request.url, "https://api.example.com/v1/weather/Singapore?units=metric");
  assert.equal(request.method, "GET");
  assert.equal(request.headers.accept, "application/json");
});

test("what is left out is left out", () => {
  const request = built(requestFor(skill(), { city: "Oslo" }));
  assert.equal(request.url, "https://api.example.com/v1/weather/Oslo");
});

test("what is needed and missing is refused", () => {
  const one = requestFor(skill(), { units: "metric" });
  assert.ok("wrong" in one && /city is needed/.test(one.wrong));
});

test("a value cannot climb out of its own segment", () => {
  const request = built(requestFor(skill(), { city: "../../admin/keys" }));
  assert.equal(request.url, "https://api.example.com/v1/weather/..%2F..%2Fadmin%2Fkeys");
});

test("a value cannot send the request somewhere else", () => {
  for (const city of ["evil.example.com", "..", "@evil.example.com", "%2e%2e%2f"]) {
    const request = built(requestFor(skill(), { city }));
    assert.equal(
      new URL(request.url).origin,
      "https://api.example.com",
      `${city} moved the request`,
    );
  }
});

test("a credential is fetched at the moment of the call and put where it belongs", () => {
  const bearer = built(requestFor(
    skill({ auth: { mode: "bearer", credential: "weather" } }),
    { city: "Oslo" },
    "sk-secret",
  ));
  assert.equal(bearer.headers.authorization, "Bearer sk-secret");

  const header = built(requestFor(
    skill({ auth: { mode: "header", credential: "weather", header: "x-api-key" } }),
    { city: "Oslo" },
    "sk-secret",
  ));
  assert.equal(header.headers["x-api-key"], "sk-secret");

  const query = built(requestFor(
    skill({ auth: { mode: "query", credential: "weather", query: "key" } }),
    { city: "Oslo" },
    "sk-secret",
  ));
  assert.match(query.url, /key=sk-secret/);
});

test("a skill whose credential is not held does not go out without it", () => {
  const one = requestFor(skill({ auth: { mode: "bearer", credential: "weather" } }), { city: "Oslo" });
  assert.ok("wrong" in one && /is not held/.test(one.wrong));
});

test("what is sent in a body is sent as one", () => {
  const request = built(requestFor(
    skill({
      method: "POST",
      url: "https://api.example.com/v1/notes",
      parameters: [
        { name: "title", in: "body", kind: "string", required: true, about: "x" },
        { name: "pinned", in: "body", kind: "boolean", required: false, about: "y" },
      ],
    }),
    { title: "a thought", pinned: true },
  ));

  assert.equal(request.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(request.body!), { title: "a thought", pinned: true });
});

test("a value of the wrong kind is refused", () => {
  const one = requestFor(
    skill({
      url: "https://api.example.com/v1/weather",
      parameters: [{ name: "days", in: "query", kind: "number", required: true, about: "x" }],
    }),
    { days: "seven" },
  );
  assert.ok("wrong" in one && /should be a number/.test(one.wrong));
});

test("nothing said about a failure carries the credential in it", () => {
  assert.equal(scrub("401 from https://x?key=sk-secret", "sk-secret"), "401 from https://x?key=[credential]");
  assert.equal(scrub("plain trouble", "sk-secret"), "plain trouble");
});
