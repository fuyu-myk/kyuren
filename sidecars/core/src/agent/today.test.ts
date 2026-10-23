import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { todayTool } from "#agent/today.ts";
import { invoke, type Ask } from "#agent/tool.ts";
import type { Source } from "#connect/source.ts";
import { Gate } from "#permission/gate.ts";

test("a question the day asks about a source goes through the call's own asking, so the call is known to have asked", async () => {
  const calendar: Source = {
    name: "calendar",
    effect: "outbound",
    origin: "https://calendar.example",
    available: () => true,
    read: async () => [],
  };
  const vault = mkdtempSync(join(tmpdir(), "kyuren-today-"));
  const gate = new Gate(() => [{ path: vault, mode: "write" }], () => {});
  const asked: string[] = [];
  const asking: Ask = async (action) => {
    asked.push(action.target);
    return "allow";
  };

  const outcome = await invoke(todayTool([calendar], 1, 1, gate, vault), {}, gate, asking, new AbortController().signal);
  assert.equal(outcome.ok, true);
  assert.deepEqual(asked, ["https://calendar.example"]);
});
