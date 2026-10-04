import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const where = mkdtempSync(join(tmpdir(), "kyuren-forge-"));
process.env.KYUREN_SKILLS = join(where, "skills.db");
after(() => rmSync(where, { recursive: true, force: true }));

const { forgeTool } = await import("#agent/forge.ts");
const { skillTool } = await import("#agent/skill.ts");
const { sharedSkills } = await import("#skill/shared.ts");
const { untried } = await import("#skill/shape.ts");

/// Any call that reaches this has already got past everything being tested.
const reached: string[] = [];
globalThis.fetch = (async (input: unknown) => {
  reached.push(String(input));
  return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

const draft = {
  name: "weather_now",
  about: "The current weather in a named city.",
  method: "GET" as const,
  url: "https://api.example.com/v1/weather/{city}",
  parameters: [
    { name: "city", in: "path" as const, kind: "string" as const, required: true, about: "the city" },
  ],
  headers: {},
  reads: "json" as const,
  auth: "none" as const,
  credential: "",
  authHeader: "",
  authQuery: "",
};

const nothing = new AbortController().signal;

test("a skill the model has just written cannot then be used by it", async () => {
  const forged = await forgeTool().run(draft, nothing) as { drafted: boolean; name: string };
  assert.equal(forged.drafted, true);
  assert.equal(sharedSkills().named("weather_now")!.state, "pending");

  const used = await skillTool().run(
    { name: "weather_now", values: { city: "Oslo" } },
    nothing,
  ) as { ok: boolean; reason: string };

  assert.equal(used.ok, false);
  assert.match(used.reason, /pending and has not been approved/);
  assert.deepEqual(reached, [], "forging and calling in one breath reached the network");
});

test("a skill nobody drafted cannot be used by naming it", async () => {
  const used = await skillTool().run(
    { name: "anything_at_all", values: {} },
    nothing,
  ) as { ok: boolean; reason: string };

  assert.equal(used.ok, false);
  assert.match(used.reason, /no skill called/);
  assert.deepEqual(reached, []);
});

test("a draft that would reach this machine is refused outright", async () => {
  const forged = await forgeTool().run(
    { ...draft, name: "metadata_peek", url: "https://169.254.169.254/latest/{path}",
      parameters: [{ name: "path", in: "path", kind: "string", required: true, about: "x" }] },
    nothing,
  ) as { drafted: boolean; wrong: string[] };

  assert.equal(forged.drafted, false);
  assert.match(forged.wrong.join(), /this machine or its network/);
  assert.equal(sharedSkills().named("metadata_peek"), undefined);
});

test("a draft that would take over the name of a real tool is refused", async () => {
  const forged = await forgeTool().run(
    { ...draft, name: "remember" },
    nothing,
  ) as { drafted: boolean; wrong: string[] };

  assert.equal(forged.drafted, false);
  assert.match(forged.wrong.join(), /already the name/);
});

test("once approved, and only then, the skill reaches out", async () => {
  const skills = sharedSkills();
  const found = skills.named("weather_now")!;
  skills.approve(found.id);

  const tool = skillTool(async () => ["93.184.216.34"]);
  const asking = { name: "weather_now", values: { city: "Oslo" } };
  tool.describe(asking);
  const used = await tool.run(asking, nothing) as { ok: boolean };

  assert.equal(used.ok, true);
  assert.deepEqual(reached, ["https://api.example.com/v1/weather/Oslo"]);
});

test("a skill is asked about with the values it would send", () => {
  assert.equal(skillTool().describe({ name: "weather_now", values: { city: "Oslo", days: 3 } }).carrying, "city: Oslo, days: 3");
});

test("a newly approved skill is asked about at its first call, by name, and not again once that call is made", async () => {
  await forgeTool().run({ ...draft, name: "weather_soon", url: "https://api.example.com/v1/forecast/{city}" }, nothing);
  const skills = sharedSkills();
  skills.approve(skills.named("weather_soon")!.id);
  const tool = skillTool(async () => ["93.184.216.34"]);
  const asking = { name: "weather_soon", values: { city: "Oslo" } };

  assert.match(tool.describe(asking).first ?? "", /weather_soon has not been used since it was approved/);
  const used = await tool.run(asking, nothing) as { ok: boolean };
  assert.equal(used.ok, true);
  assert.equal(tool.describe(asking).first, undefined);
});

test("a skill approved again while a call to it was being asked about is not called under the new approval", async () => {
  await forgeTool().run({ ...draft, name: "weather_later", url: "https://api.example.com/v1/later/{city}" }, nothing);
  const skills = sharedSkills();
  const later = skills.named("weather_later")!;
  skills.approve(later.id, 1000);
  const tool = skillTool(async () => ["93.184.216.34"]);
  const asking = { name: "weather_later", values: { city: "Oslo" } };
  tool.describe(asking);

  skills.revise(later.id, { ...skills.named("weather_later")!, url: "https://api.example.net/v1/later/{city}" }, 2000);
  skills.approve(later.id, 3000);
  const refused = await tool.run(asking, nothing) as { ok: boolean; reason: string };
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /weather_later changed while it was being asked about/);
  assert.equal(untried(skills.named("weather_later")!), true, "the new approval's first call is still to be asked about");

  const again = { name: "weather_later", values: { city: "Oslo" } };
  assert.match(tool.describe(again).first ?? "", /weather_later has not been used/);
  assert.equal((await tool.run(again, nothing) as { ok: boolean }).ok, true);
});
