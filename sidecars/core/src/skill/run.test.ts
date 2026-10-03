import assert from "node:assert/strict";
import { test } from "node:test";
import { remember } from "#connect/secrets.ts";
import { runSkill } from "#skill/run.ts";

const PUBLIC = async () => ["93.184.216.34"];
import type { Draft } from "#skill/shape.ts";
import { Skills } from "#skill/store.ts";

function draft(changes: Partial<Draft> = {}): Draft {
  return {
    name: "weather_now",
    about: "The current weather in a named city.",
    method: "GET",
    url: "https://api.example.com/v1/weather/{city}",
    parameters: [{ name: "city", in: "path", kind: "string", required: true, about: "the city" }],
    headers: {},
    auth: { mode: "none" },
    reads: "json",
    ...changes,
  };
}

/// Nothing in these tests may reach the network. A skill that got as far as fetch would be a skill
/// that got past the check being tested, so the call itself is made to fail loudly.
const reached: string[] = [];
globalThis.fetch = (async (input: unknown) => {
  reached.push(String(input));
  throw new Error("the network was reached");
}) as typeof fetch;

test("a pending skill cannot be run", async () => {
  const skills = new Skills(":memory:");
  const one = skills.draft(draft());

  const ran = await runSkill(skills, one.id, { city: "Oslo" });
  assert.equal(ran.ok, false);
  assert.match((ran as { reason: string }).reason, /pending and has not been approved/);
  assert.deepEqual(reached, [], "a pending skill must never reach the network");
});

test("a skill that was approved and then changed cannot be run either", async () => {
  const skills = new Skills(":memory:");
  const one = skills.draft(draft());
  skills.approve(one.id);
  skills.revise(one.id, draft({ url: "https://elsewhere.example.com/{city}" }));

  const ran = await runSkill(skills, one.id, { city: "Oslo" });
  assert.equal(ran.ok, false);
  assert.match((ran as { reason: string }).reason, /has not been approved/);
  assert.deepEqual(reached, []);
});

test("a broken skill is not tried again", async () => {
  const skills = new Skills(":memory:");
  const one = skills.draft(draft());
  skills.approve(one.id);
  skills.breaks(one.id, "answered 500");

  const ran = await runSkill(skills, one.id, { city: "Oslo" });
  assert.equal(ran.ok, false);
  assert.match((ran as { reason: string }).reason, /broken/);
  assert.deepEqual(reached, []);
});

test("a skill nobody has heard of cannot be run", async () => {
  const skills = new Skills(":memory:");
  const ran = await runSkill(skills, "made-up", {});
  assert.equal(ran.ok, false);
  assert.match((ran as { reason: string }).reason, /no such skill/);
  assert.deepEqual(reached, []);
});

test("an approved skill missing a needed value does not go out half formed", async () => {
  const skills = new Skills(":memory:");
  const one = skills.draft(draft());
  skills.approve(one.id);

  const ran = await runSkill(skills, one.id, {});
  assert.equal(ran.ok, false);
  assert.match((ran as { reason: string }).reason, /city is needed/);
  assert.deepEqual(reached, []);
});

test("a skill that cannot be reached is marked broken and says why", async () => {
  const skills = new Skills(":memory:");
  const one = skills.draft(draft());
  skills.approve(one.id);
  remember("skill:weather", "sk-secret");

  const ran = await runSkill(skills, one.id, { city: "Oslo" }, PUBLIC);
  assert.equal(ran.ok, false);
  assert.equal((ran as { broke: boolean }).broke, true);
  assert.equal(skills.find(one.id)!.state, "broken");
  assert.match(skills.find(one.id)!.trouble!, /could not be reached/);
  assert.equal(reached.length, 1, "an approved skill is the only thing that reaches out");
});

test("what is said about a failure never carries the credential", async () => {
  const skills = new Skills(":memory:");
  const one = skills.draft(draft({ auth: { mode: "bearer", credential: "weather" } }));
  skills.approve(one.id);
  remember("skill:weather", "sk-a-very-secret-value");

  const ran = await runSkill(skills, one.id, { city: "Oslo" }, PUBLIC);
  const said = JSON.stringify(ran) + JSON.stringify(skills.find(one.id));
  assert.ok(!said.includes("sk-a-very-secret-value"), "a credential appeared in what was reported");
});

test("a skill follows a redirect within its own address, and not one anywhere else, which could be this machine", async () => {
  const skills = new Skills(":memory:");
  const one = skills.draft(draft());
  skills.approve(one.id);
  const before = globalThis.fetch;
  const asked: Array<[string, RequestInit["redirect"]]> = [];
  let next = "https://api.example.com/v1/weather/Oslo/";
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    asked.push([String(input), init?.redirect]);
    if (asked.length === 1) return new Response(null, { status: 301, headers: { location: next } });
    return new Response(JSON.stringify({ temperature: 3 }), { status: 200 });
  }) as typeof fetch;
  try {
    const ran = await runSkill(skills, one.id, { city: "Oslo" }, PUBLIC);
    assert.equal(ran.ok, true, JSON.stringify(ran));
    assert.deepEqual(asked, [
      ["https://api.example.com/v1/weather/Oslo", "manual"],
      ["https://api.example.com/v1/weather/Oslo/", "manual"],
    ]);

    asked.length = 0;
    next = "http://127.0.0.1:11434/api/tags";
    const sent = await runSkill(skills, one.id, { city: "Oslo" }, PUBLIC);
    assert.equal(sent.ok, false);
    assert.match((sent as { reason: string }).reason, /elsewhere/);
    assert.equal(asked.length, 1, "the second address is never asked");
    assert.equal(skills.find(one.id)?.state, "approved", "being sent elsewhere is not the skill breaking");
  } finally {
    globalThis.fetch = before;
  }
});

test("a skill whose address leads to this machine or its network is not called, and is not broken for it", async () => {
  const skills = new Skills(":memory:");
  const one = skills.draft(draft());
  skills.approve(one.id);
  const before = reached.length;
  const ran = await runSkill(skills, one.id, { city: "Oslo" }, async () => ["127.0.0.1"]);
  assert.equal(ran.ok, false);
  assert.match((ran as { reason: string }).reason, /this machine or its network/);
  assert.equal(reached.length, before, "the network was never reached");
  assert.equal(skills.find(one.id)?.state, "approved");
});
