import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { untried, type Draft } from "#skill/shape.ts";
import { Skills } from "#skill/store.ts";

function draft(changes: Partial<Draft> = {}): Draft {
  return {
    name: "weather_now",
    about: "The current weather in a named city.",
    method: "GET",
    url: "https://api.example.com/v1/weather/{city}",
    parameters: [
      { name: "city", in: "path", kind: "string", required: true, about: "the city" },
    ],
    headers: {},
    auth: { mode: "none" },
    reads: "json",
    ...changes,
  };
}

test("a skill is written down inert", () => {
  const skills = new Skills(":memory:");
  const one = skills.draft(draft());

  assert.equal(one.state, "pending");
  assert.equal(skills.find(one.id)!.state, "pending");
  assert.deepEqual(skills.list("approved"), []);
});

test("approving is the only thing that makes a skill callable", () => {
  const skills = new Skills(":memory:");
  const one = skills.draft(draft());

  assert.equal(skills.approve(one.id), true);
  assert.equal(skills.find(one.id)!.state, "approved");
  assert.equal(skills.list("approved").length, 1);
  assert.equal(skills.approve("nobody"), false);
});

test("changing what an approved skill asks for takes its approval away", () => {
  const skills = new Skills(":memory:");
  const one = skills.draft(draft());
  skills.approve(one.id);

  const changed = skills.revise(one.id, draft({ url: "https://elsewhere.example.com/{city}" }))!;
  assert.equal(changed.state, "pending", "approval is of a request, not of a name");
  assert.equal(changed.approved, undefined);
  assert.equal(changed.url, "https://elsewhere.example.com/{city}");
  assert.deepEqual(skills.list("approved"), []);
});

test("a skill that has started failing is no longer approved", () => {
  const skills = new Skills(":memory:");
  const one = skills.draft(draft());
  skills.approve(one.id);
  skills.breaks(one.id, "the address answered 404 three times");

  const found = skills.find(one.id)!;
  assert.equal(found.state, "broken");
  assert.match(found.trouble!, /404/);
  assert.deepEqual(skills.list("approved"), []);
});

test("a skill brought back from broken is approved again on purpose", () => {
  const skills = new Skills(":memory:");
  const one = skills.draft(draft());
  skills.breaks(one.id, "gone");
  skills.approve(one.id);

  assert.equal(skills.find(one.id)!.state, "approved");
  assert.equal(skills.find(one.id)!.trouble, undefined);
});

test("two skills cannot share a name", () => {
  const skills = new Skills(":memory:");
  skills.draft(draft());
  assert.throws(() => skills.draft(draft()));
  assert.deepEqual(skills.names(), ["weather_now"]);
});

test("skills outlive the process that forged them", () => {
  const where = mkdtempSync(join(tmpdir(), "kyuren-skills-"));
  try {
    const before = new Skills(join(where, "skills.db"));
    const one = before.draft(draft());
    before.approve(one.id);
    before.close();

    const after = new Skills(join(where, "skills.db"));
    const found = after.find(one.id)!;
    assert.equal(found.state, "approved");
    assert.equal(found.url, "https://api.example.com/v1/weather/{city}");
    assert.equal(found.parameters[0]!.name, "city");
    after.close();
  } finally {
    rmSync(where, { recursive: true, force: true });
  }
});

test("a skill let go of is gone", () => {
  const skills = new Skills(":memory:");
  const one = skills.draft(draft());
  skills.forget(one.id);
  assert.equal(skills.find(one.id), undefined);
  assert.deepEqual(skills.list(), []);
});

test("an approved skill is untried until a call to it is confirmed, and is again once changed and approved anew", () => {
  const skills = new Skills(":memory:");
  const one = skills.draft(draft());
  skills.approve(one.id, 1000);
  assert.equal(untried(skills.find(one.id)!), true);

  skills.confirm(one.id, 1000);
  assert.equal(untried(skills.find(one.id)!), false);

  skills.revise(one.id, draft({ url: "https://api.example.com/v2/weather/{city}" }), 2000);
  skills.approve(one.id, 3000);
  assert.equal(untried(skills.find(one.id)!), true, "approval is of a request, and this is another one");
});

test("a confirmation is of one approval, so one given for an earlier approval confirms nothing", () => {
  const skills = new Skills(":memory:");
  const one = skills.draft(draft());
  skills.approve(one.id, 1000);
  skills.confirm(one.id, 999);
  assert.equal(untried(skills.find(one.id)!), true);
});

test("skills kept before confirmations were opens with every approved skill untried", () => {
  const dir = mkdtempSync(join(tmpdir(), "kyuren-skills-old-"));
  try {
    const path = join(dir, "skills.db");
    const old = new DatabaseSync(path);
    old.exec(`create table skills (id text primary key, name text not null unique, state text not null,
      drafted integer not null, approved integer, trouble text, template text not null)`);
    old.prepare("insert into skills values (?, ?, ?, ?, ?, ?, ?)").run("s1", "weather_now", "approved", 1, 2, null, JSON.stringify(draft()));
    old.close();

    const skills = new Skills(path);
    assert.equal(skills.named("weather_now")!.state, "approved");
    assert.equal(untried(skills.named("weather_now")!), true);
    skills.confirm("s1", 2);
    assert.equal(untried(skills.named("weather_now")!), false);
    skills.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an approved skill changed keeps what was approved, and why it changed, until approved again", () => {
  const skills = new Skills(":memory:");
  const one = skills.draft(draft());
  skills.approve(one.id);
  skills.revise(one.id, draft({ url: "https://api.example.com/v2/weather/{city}" }), Date.now(), "the API moved to v2");

  const changed = skills.find(one.id)!;
  assert.equal(changed.before?.url, "https://api.example.com/v1/weather/{city}");
  assert.equal(changed.why, "the API moved to v2");

  skills.revise(one.id, draft({ url: "https://api.example.com/v3/weather/{city}" }), Date.now(), "and again to v3");
  assert.equal(skills.find(one.id)!.before?.url, "https://api.example.com/v1/weather/{city}", "what was approved is what is shown, however many changes since");

  skills.approve(one.id);
  assert.equal(skills.find(one.id)!.before, undefined);
  assert.equal(skills.find(one.id)!.why, undefined);
});

test("a draft never approved has nothing approved to show when it changes", () => {
  const skills = new Skills(":memory:");
  const one = skills.draft(draft());
  skills.revise(one.id, draft({ about: "The weather now, in a named city." }), Date.now(), "clearer");
  assert.equal(skills.find(one.id)!.before, undefined);
});

test("the values a skill was used with are kept, newest first, a few of each, and go with it", () => {
  const skills = new Skills(":memory:");
  const one = skills.draft(draft());
  for (let at = 0; at < 10; at += 1) skills.used(one.id, { city: `town${at}`, metric: true }, 1000 + at);
  skills.used(one.id, { city: "town3" }, 2000);

  const recent = skills.recent(one.id);
  assert.deepEqual(recent.city?.slice(0, 3), ["town3", "town9", "town8"]);
  assert.equal(recent.city?.length, 8);
  assert.deepEqual(recent.metric, ["true"]);

  skills.forget(one.id);
  assert.deepEqual(skills.recent(one.id), {});
});

test("approving is of the skill as it was shown, so one changed since is not approved", () => {
  const skills = new Skills(":memory:");
  const one = skills.draft(draft(), 1000);
  skills.revise(one.id, draft({ url: "https://collect.example.net/{city}" }), 2000);
  assert.equal(skills.approve(one.id, Date.now(), 1000), false);
  assert.equal(skills.find(one.id)!.state, "pending");
  assert.equal(skills.approve(one.id, Date.now(), 2000), true);
  assert.equal(skills.find(one.id)!.state, "approved");
});

test("a change made in the same moment as the one shown is still told apart from it", () => {
  const skills = new Skills(":memory:");
  const one = skills.draft(draft(), 1000);
  skills.revise(one.id, draft({ url: "https://collect.example.net/{city}" }), 1000);
  assert.equal(skills.approve(one.id, Date.now(), 1000), false);
  assert.equal(skills.find(one.id)!.state, "pending");
});
