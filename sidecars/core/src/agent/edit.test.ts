import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const where = mkdtempSync(join(tmpdir(), "kyuren-edit-"));
process.env.KYUREN_SKILLS = join(where, "skills.db");
after(() => rmSync(where, { recursive: true, force: true }));

const { editTool } = await import("#agent/edit.ts");
const { skillTool } = await import("#agent/skill.ts");
const { sharedSkills } = await import("#skill/shared.ts");

const PUBLIC = async () => ["93.184.216.34"];
const nothing = new AbortController().signal;

let answering: () => Response = () => new Response(JSON.stringify({ location: { name: "Oslo" }, current: { temp_c: 3, windy: true } }), { status: 200 });
const reached: string[] = [];
globalThis.fetch = (async (input: unknown) => {
  reached.push(String(input));
  return answering();
}) as typeof fetch;

function approved(name: string) {
  const skills = sharedSkills();
  const one = skills.draft({
    name,
    about: "The current weather in a named city.",
    method: "GET",
    url: "https://api.example.com/v1/current.json",
    parameters: [{ name: "q", in: "query", kind: "string", required: true, about: "the place" }],
    headers: {},
    auth: { mode: "none" },
    reads: "json",
  });
  skills.approve(one.id);
  return one;
}

/// Calls a tool as the model would, past a gate that has already said yes, as each tool's own
/// standing is what is under test here.
async function used(tool: ReturnType<typeof skillTool>, args: { name: string; values: Record<string, string> }) {
  tool.describe(args);
  return await tool.run(args, nothing) as Record<string, unknown>;
}

test("a skill changed by the model waits to be approved again, keeping what was approved and why, and cannot be used until then", async () => {
  const one = approved("weather_edit");
  const edited = await editTool().run({ name: "weather_edit", why: "the API moved to v2", url: "https://api.example.com/v2/current.json" }, nothing) as Record<string, unknown>;
  assert.equal(edited.revised, true, JSON.stringify(edited));
  assert.deepEqual(edited.changed, ["url"]);

  const now = sharedSkills().find(one.id)!;
  assert.equal(now.state, "pending");
  assert.equal(now.before?.url, "https://api.example.com/v1/current.json");
  assert.equal(now.why, "the API moved to v2");

  reached.length = 0;
  const tried = await used(skillTool(PUBLIC), { name: "weather_edit", values: { q: "Oslo" } });
  assert.equal(tried.ok, false);
  assert.match(String(tried.reason), /pending and has not been approved/);
  const tested = await used(skillTool(PUBLIC, "test"), { name: "weather_edit", values: { q: "Oslo" } });
  assert.equal(tested.worked, false);
  assert.deepEqual(reached, [], "a changed skill reached the network before it was approved again");
});

test("a change that changes nothing, breaks the rules, or names no skill is refused, and the skill stands as it was", async () => {
  const one = approved("weather_same");
  const same = await editTool().run({ name: "weather_same", why: "tidier", url: "https://api.example.com/v1/current.json" }, nothing) as Record<string, unknown>;
  assert.equal(same.revised, false);
  const wrong = await editTool().run({ name: "weather_same", why: "plainer", url: "http://api.example.com/v1/current.json" }, nothing) as Record<string, unknown>;
  assert.equal(wrong.revised, false);
  assert.equal(sharedSkills().find(one.id)!.state, "approved");
  const nobody = await editTool().run({ name: "no_such_skill", why: "x", about: "Something else entirely." }, nothing) as Record<string, unknown>;
  assert.equal(nobody.revised, false);
});

test("a key's name or place can be changed on its own, the rest kept", async () => {
  const one = approved("weather_keyed");
  const edited = await editTool().run({ name: "weather_keyed", why: "it needs a key", auth: "query", credential: "weatherapi", authQuery: "key" }, nothing) as Record<string, unknown>;
  assert.deepEqual(edited.changed, ["auth"]);
  const now = sharedSkills().find(one.id)!;
  assert.deepEqual(now.auth, { mode: "query", credential: "weatherapi", query: "key" });
  assert.equal(now.url, "https://api.example.com/v1/current.json");
});

test("testing an approved skill says whether it worked and what its answer holds, and keeps no values", async () => {
  const one = approved("weather_tested");
  const tested = await used(skillTool(PUBLIC, "test"), { name: "weather_tested", values: { q: "Oslo" } });
  assert.equal(tested.worked, true, JSON.stringify(tested));
  assert.deepEqual(tested.holds, { location: { name: "string" }, current: { temp_c: "number", windy: "boolean" } });
  assert.deepEqual(sharedSkills().recent(one.id), {}, "a test's sample values are not the user's");

  answering = () => new Response(JSON.stringify({ message: "No such endpoint" }), { status: 404 });
  const failed = await used(skillTool(PUBLIC, "test"), { name: "weather_tested", values: { q: "Oslo" } });
  assert.equal(failed.worked, false);
  assert.match(String(failed.reason), /answered 404: No such endpoint/);
  assert.equal(sharedSkills().find(one.id)!.state, "broken");
  answering = () => new Response("{}", { status: 200 });
});

test("using a skill keeps the values it was given, to be offered again", async () => {
  const one = approved("weather_used");
  const ran = await used(skillTool(PUBLIC), { name: "weather_used", values: { q: "Singapore" } });
  assert.equal(ran.ok, true, JSON.stringify(ran));
  assert.deepEqual(sharedSkills().recent(one.id), { q: ["Singapore"] });
});

test("only the values a skill takes are kept, so nothing planted beside them is offered again", async () => {
  const one = approved("weather_planted");
  await used(skillTool(PUBLIC), { name: "weather_planted", values: { q: "Bergen", planted: "rm -rf" } });
  assert.deepEqual(sharedSkills().recent(one.id), { q: ["Bergen"] });
});
