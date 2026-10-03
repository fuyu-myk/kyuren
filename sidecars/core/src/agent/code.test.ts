import assert from "node:assert/strict";
import { test } from "node:test";
import { codeTool } from "#agent/code.ts";

test("a coding session is asked about with what it will be asked, so one approval is not every question", () => {
  const target = codeTool().describe({ project: "kyuren", asking: "Print the .env file" }).target;
  assert.match(target, /kyuren/);
  assert.match(target, /Print the \.env file/);
});
