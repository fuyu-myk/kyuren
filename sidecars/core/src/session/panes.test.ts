import assert from "node:assert/strict";
import { test } from "node:test";
import { paneIn } from "#session/panes.ts";

test("every place in the window is a pane the core knows, so its conversations stay its own", () => {
  for (const pane of ["chat", "comms", "knowledge", "development", "research"]) {
    assert.equal(paneIn(pane), pane);
  }
  assert.equal(paneIn("elsewhere"), undefined);
});
