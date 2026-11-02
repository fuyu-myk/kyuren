import assert from "node:assert/strict";
import { test } from "node:test";
import { changesOf, hostOf, improving, keyFor, keyText, lookalike } from "./changes.ts";
import type { Skill } from "./sessions.ts";

const was = {
  name: "weather_now",
  about: "The current weather.",
  method: "GET",
  url: "https://api.example.com/v1/current.json",
  parameters: [{ name: "q", in: "query" as const, kind: "string" as const, required: true, about: "" }],
  headers: {},
  auth: { mode: "none" as const },
  reads: "json" as const,
};

function skill(changes: Partial<Skill> = {}): Skill {
  return { ...was, id: "s1", state: "approved", drafted: 0, ...changes };
}

test("a changed skill says each thing that changed, as it was and as it would be", () => {
  const changed = skill({
    state: "pending",
    url: "https://api.example.com/v2/current.json",
    parameters: [...was.parameters, { name: "aqi", in: "query", kind: "string", required: false, about: "" }],
    auth: { mode: "query", credential: "weatherapi", query: "key" },
    before: was,
    why: "the API moved to v2",
  });
  assert.deepEqual(changesOf(changed), [
    { what: "request", was: "GET https://api.example.com/v1/current.json", now: "GET https://api.example.com/v2/current.json" },
    { what: "takes", was: "q (string in query, needed)", now: "q (string in query, needed), aqi (string in query)" },
    { what: "key", was: "none", now: "in the query as key=, from the keychain as weatherapi" },
  ]);
});

test("a skill with nothing approved before it has no changes to show", () => {
  assert.deepEqual(changesOf(skill({ state: "pending" })), []);
});

test("improving a working skill tests it first, and mending a broken one starts from what went wrong", () => {
  assert.match(improving(skill()), /^Improve the skill weather_now\. Test it with skill_test/);
  const mending = improving(skill({ state: "broken", trouble: "weather_now answered 404: No such endpoint" }));
  assert.match(mending, /^Mend the skill weather_now, which broke: weather_now answered 404: No such endpoint\./);
  assert.match(mending, /skill_edit/);
});

test("a skill's key is named by its credential at the host it goes to, and said where it is put", () => {
  assert.equal(hostOf("https://api.example.com:8443/v1/{city}?x=1"), "api.example.com:8443");
  assert.equal(keyFor(skill({ auth: { mode: "header", credential: "weatherapi", header: "x-api-key" } })), "weatherapi@api.example.com");
  assert.equal(keyFor(skill()), undefined);
  assert.equal(keyText({ mode: "header", credential: "weatherapi", header: "x-api-key" }), "in the x-api-key header, from the keychain as weatherapi");
  assert.equal(keyText({ mode: "bearer", credential: "weatherapi" }), "as a bearer token, from the keychain as weatherapi");
});

test("a host that reads as one thing and is another is told", () => {
  assert.equal(lookalike("https://api.example.com/v1"), undefined);
  assert.equal(lookalike("https://\u0430pi.example.com/v1"), "xn--pi-6kc.example.com");
  assert.equal(lookalike("https://API.Example.com/v1"), undefined, "case alone changes nothing");
});
