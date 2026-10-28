import assert from "node:assert/strict";
import { test } from "node:test";
import { startTool } from "#agent/start.ts";
import type { Project } from "#projects/state.ts";

const project = (name: string): Project => ({ name, path: `/x/${name}`, branch: "main", ahead: 0, behind: 0, dirty: 0 });

function started() {
  const opened: string[] = [];
  const tool = startTool(async () => [project("mmcif"), project("kyuren")], async (link) => {
    opened.push(link);
  });
  return { opened, tool, signal: new AbortController().signal };
}

test("starting a session is asked about as running something, with where and what it will be asked", () => {
  const action = started().tool.describe({ project: "mmcif", prompt: "Fix the failing test" });
  assert.equal(action.effect, "execute");
  assert.match(action.target, /mmcif/);
  assert.match(action.target, /Fix the failing test/);
});

test("a session is started in the project meant, by the link for its folder", async () => {
  const { opened, tool, signal } = started();
  assert.deepEqual(await tool.run({ project: "mmcif", prompt: "Fix the failing test" }, signal), { started: true, project: "mmcif", in: "/x/mmcif" });
  assert.deepEqual(opened, ["claude://code/new?folder=%2Fx%2Fmmcif&q=Fix%20the%20failing%20test"]);
});

test("no project by that name, or a request that would show differently from what is sent, starts nothing", async () => {
  const { opened, tool, signal } = started();
  assert.deepEqual(await tool.run({ project: "fractaldb", prompt: "Fix it" }, signal), { started: false, reason: "there is no project called fractaldb" });
  assert.equal(((await tool.run({ project: "mmcif", prompt: "Fix it​" }, signal)) as { started: boolean }).started, false);
  assert.deepEqual(opened, []);
});
