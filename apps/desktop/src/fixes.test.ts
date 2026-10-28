import assert from "node:assert/strict";
import { test } from "node:test";
import { fixMain, fixPull } from "./fixes.ts";

test("a session sent to fix the main branch is handed where its checks are seen", () => {
  assert.equal(
    fixMain("someone/kyuren"),
    "The checks on the newest commit of someone/kyuren's default branch are failing on GitHub "
      + "(https://github.com/someone/kyuren/commits). Find out why and fix them.",
  );
});

test("a session sent to fix a pull request is handed its checks, by number and nothing its author wrote", () => {
  assert.equal(
    fixPull("someone/kyuren", 38),
    "The checks on pull request #38 in someone/kyuren are failing on GitHub "
      + "(https://github.com/someone/kyuren/pull/38/checks). Find out why and fix them on its branch.",
  );
});
