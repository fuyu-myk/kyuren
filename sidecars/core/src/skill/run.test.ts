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
  remember("skill:weather@api.example.com", "sk-a-very-secret-value");

  const ran = await runSkill(skills, one.id, { city: "Oslo" }, PUBLIC);
  const said = JSON.stringify(ran) + JSON.stringify(skills.find(one.id));
  assert.ok(!said.includes("sk-a-very-secret-value"), "a credential appeared in what was reported");
});

test("a key the service refuses is said to be refused, in the service's words, and the skill is not broken for it", async () => {
  const before = globalThis.fetch;
  try {
    for (const status of [401, 403]) {
      const skills = new Skills(":memory:");
      const one = skills.draft(draft({ auth: { mode: "query", credential: "weather", query: "key" } }));
      skills.approve(one.id);
      remember("skill:weather@api.example.com", "sk-the-key-itself");
      globalThis.fetch = (async () => new Response(
        JSON.stringify({ error: { code: 2006, message: "API key provided is invalid: sk-the-key-itself" } }),
        { status },
      )) as typeof fetch;

      const ran = await runSkill(skills, one.id, { city: "Oslo" }, PUBLIC) as { ok: boolean; reason: string; broke: boolean };
      assert.equal(ran.ok, false);
      assert.equal(ran.broke, false, "a key refused is the key's trouble, and approving the skill again would not mend it");
      assert.match(ran.reason, new RegExp(`the key for weather was refused \\(${status}\\): API key provided is invalid`));
      assert.ok(!ran.reason.includes("sk-the-key-itself"), "the key appeared in what was reported");
      assert.equal(skills.find(one.id)!.state, "approved");
    }
  } finally {
    globalThis.fetch = before;
  }
});

test("a skill that answers with a failure is broken, and says what the service said", async () => {
  const before = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ message: "No such endpoint" }), { status: 404 })) as typeof fetch;
  try {
    const skills = new Skills(":memory:");
    const one = skills.draft(draft());
    skills.approve(one.id);

    const ran = await runSkill(skills, one.id, { city: "Oslo" }, PUBLIC) as { reason: string; broke: boolean };
    assert.equal(ran.broke, true);
    assert.equal(ran.reason, "weather_now answered 404: No such endpoint");
    assert.equal(skills.find(one.id)!.state, "broken");
  } finally {
    globalThis.fetch = before;
  }
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

test("a key is given only to the host it was kept for, so a skill elsewhere naming it finds nothing", async () => {
  const before = globalThis.fetch;
  const asked: string[] = [];
  globalThis.fetch = (async (input: unknown) => {
    asked.push(String(input));
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    const skills = new Skills(":memory:");
    const keyed = { mode: "query" as const, credential: "weather", query: "key" };
    const home = skills.draft(draft({ name: "weather_home", url: "https://api.example.com/v1/weather/{city}", auth: keyed }));
    const away = skills.draft(draft({ name: "weather_away", url: "https://collect.example.net/{city}", auth: keyed }));
    skills.approve(home.id);
    skills.approve(away.id);
    remember("skill:weather@api.example.com", "sk-kept-for-one-host");

    const elsewhere = await runSkill(skills, away.id, { city: "Oslo" }, PUBLIC) as { ok: boolean; reason: string };
    assert.equal(elsewhere.ok, false);
    assert.equal(elsewhere.reason, "the key for weather at collect.example.net is not held");
    assert.deepEqual(asked, [], "the key went to a host it was not kept for");

    const at = await runSkill(skills, home.id, { city: "Oslo" }, PUBLIC);
    assert.equal(at.ok, true, JSON.stringify(at));
    assert.deepEqual(asked, ["https://api.example.com/v1/weather/Oslo?key=sk-kept-for-one-host"]);
  } finally {
    globalThis.fetch = before;
  }
});

test("an answer that echoes the key has it taken out, in every form it can come back in", async () => {
  const secret = "sk-a/b+c=d e";
  const before = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => new Response(JSON.stringify({
    echoed: String(input),
    raw: secret,
    encoded: encodeURIComponent(secret),
    form: encodeURIComponent(secret).replace(/%20/g, "+"),
    escaped: JSON.stringify(secret).slice(1, -1),
    base64: Buffer.from(secret).toString("base64"),
  }), { status: 200 })) as typeof fetch;
  try {
    const skills = new Skills(":memory:");
    const one = skills.draft(draft({ auth: { mode: "query", credential: "weather", query: "key" } }));
    skills.approve(one.id);
    remember("skill:weather@api.example.com", secret);
    const ran = await runSkill(skills, one.id, { city: "Oslo" }, PUBLIC) as { ok: boolean; read: unknown };
    assert.equal(ran.ok, true);
    const said = JSON.stringify(ran.read);
    for (const form of [secret, encodeURIComponent(secret), "sk-a%2Fb%2Bc%3Dd+e", Buffer.from(secret).toString("base64")]) {
      assert.ok(!said.includes(form), `the key came back as ${form}`);
    }
    assert.match(said, /\[credential\]/);
  } finally {
    globalThis.fetch = before;
  }
});

test("a path value of . or .. is refused, so the request keeps the shape it was approved with", async () => {
  const skills = new Skills(":memory:");
  const one = skills.draft(draft());
  skills.approve(one.id);
  const ran = await runSkill(skills, one.id, { city: ".." }, PUBLIC) as { ok: boolean; reason: string };
  assert.equal(ran.ok, false);
  assert.equal(ran.reason, "city cannot be . or ..");
});

test("an answer is read no further than what is kept of it", async () => {
  const before = globalThis.fetch;
  let pulled = 0;
  globalThis.fetch = (async () => new Response(new ReadableStream({
    pull(controller) {
      pulled += 1;
      if (pulled > 1000) return controller.close();
      controller.enqueue(new TextEncoder().encode("x".repeat(1024)));
    },
  }), { status: 200 })) as typeof fetch;
  try {
    const skills = new Skills(":memory:");
    const one = skills.draft(draft({ reads: "text" }));
    skills.approve(one.id);
    const ran = await runSkill(skills, one.id, { city: "Oslo" }, PUBLIC) as { ok: boolean; read: string };
    assert.equal(ran.ok, true);
    assert.ok(ran.read.length <= 20_000);
    assert.ok(pulled < 100, `read ${pulled} chunks of a body that was never going to be kept`);
  } finally {
    globalThis.fetch = before;
  }
});

test("the key is cleared however a service sends it back: as the request was encoded, escaped in json, encoded twice, or cut short", async () => {
  const secret = "tok~en!(x)'y/+=";
  const sent = new URLSearchParams({ k: secret }).toString().slice(2);
  const before = globalThis.fetch;
  let answer = "";
  globalThis.fetch = (async () => new Response(answer, { status: 200 })) as typeof fetch;
  try {
    const skills = new Skills(":memory:");
    const one = skills.draft(draft({ auth: { mode: "query", credential: "weather", query: "key" } }));
    skills.approve(one.id);
    remember("skill:weather@api.example.com", secret);
    const bodies = [
      JSON.stringify({ echoed: `https://api.example.com/x?key=${sent}`, lower: sent.toLowerCase() }),
      `{"slashed":"${secret.replace(/\//g, "\\/")}","unicode":"${secret.replace(/'/g, "\\u0027")}"}`,
      JSON.stringify({ next: `https://api.example.com/x?u=${encodeURIComponent(encodeURIComponent(secret))}` }),
      JSON.stringify({ [`key_${secret}`]: 1 }),
    ];
    for (const body of bodies) {
      answer = body;
      const ran = await runSkill(skills, one.id, { city: "Oslo" }, PUBLIC) as { ok: boolean; read: unknown };
      assert.equal(ran.ok, true, body);
      const said = JSON.stringify(ran.read);
      for (const form of [secret, sent, sent.toLowerCase(), encodeURIComponent(encodeURIComponent(secret))]) {
        assert.ok(!said.includes(form), `${body} came back holding ${form}`);
      }
      assert.ok(!decodeURIComponent(decodeURIComponent(said)).includes(secret), `${body} came back holding the key once decoded`);
    }

    const failing = new Skills(":memory:");
    const other = failing.draft(draft({ name: "weather_cut", auth: { mode: "query", credential: "weather", query: "key" } }));
    failing.approve(other.id);
    globalThis.fetch = (async () => new Response(JSON.stringify({ message: `${"x".repeat(190)}${secret}` }), { status: 500 })) as typeof fetch;
    const cut = await runSkill(failing, other.id, { city: "Oslo" }, PUBLIC) as { reason: string };
    assert.ok(!cut.reason.includes(secret.slice(0, 4)), `a cut left the start of the key: ${cut.reason}`);
  } finally {
    globalThis.fetch = before;
  }
});
