import assert from "node:assert/strict";
import { test } from "node:test";
import { projectHandlers } from "#methods/projects.ts";
import type { Project } from "#projects/state.ts";

const KYUREN: Project = { name: "kyuren", path: "/x/kyuren", branch: "main", ahead: 0, behind: 0, dirty: 0 };

function handlers() {
  const opened: string[] = [];
  const board = { projects: async () => [KYUREN], reviews: () => [] };
  const methods = projectHandlers(() => board, async (link) => {
    opened.push(link);
  });
  return { opened, start: methods["projects.start"] };
}

test("a new session is opened in a project on the board, with the request it was given or none", async () => {
  const { opened, start } = handlers();
  assert.deepEqual(await start({ path: "/x/kyuren", prompt: " fix the failing test " }), { started: true });
  assert.deepEqual(await start({ path: "/x/kyuren" }), { started: true });
  assert.deepEqual(opened, ["claude://code/new?folder=%2Fx%2Fkyuren&q=fix%20the%20failing%20test", "claude://code/new?folder=%2Fx%2Fkyuren"]);
});

test("a folder that is not a project on the board, or a request that would show differently, opens nothing", async () => {
  const { opened, start } = handlers();
  await assert.rejects(start({ path: "/etc" }), /not a project on the board/);
  await assert.rejects(start({ path: "/x/kyuren/../kyuren" }), /not a project on the board/);
  await assert.rejects(start({ path: 7 }), /not a project on the board/);
  await assert.rejects(start({ path: "/x/kyuren", prompt: "fix it‮" }), /cannot be handed/);
  await assert.rejects(start({ path: "/x/kyuren", prompt: 7 }), /cannot be handed/);
  assert.deepEqual(opened, []);
});
