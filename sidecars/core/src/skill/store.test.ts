import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Draft } from "#skill/shape.ts";
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
