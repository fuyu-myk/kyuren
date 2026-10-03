import assert from "node:assert/strict";
import { test } from "node:test";
import { looksLikeTests, testCounts } from "#coding/testruns.ts";

test("a test run is known by its command and counted from what it printed, however the runner says it", () => {
  assert.ok(looksLikeTests("cargo test shelf 2>&1 | grep result"));
  assert.ok(looksLikeTests("npm test") && looksLikeTests("node --test src/a.test.ts") && looksLikeTests("pytest -q") && looksLikeTests("go test ./..."));
  assert.ok(!looksLikeTests("git commit -m 'add test'") && !looksLikeTests("ls tests"));
  assert.ok(looksLikeTests("pnpm -C apps/desktop test") && looksLikeTests("pnpm --filter @kyuren/desktop test"), "the runner's own flags before it");
  assert.ok(looksLikeTests("cd sidecars/core && npm test 2>&1 | tail -3") && looksLikeTests("npx vitest run") && looksLikeTests("python3 -m pytest -q"));
  assert.ok(looksLikeTests("npm run test:unit") && looksLikeTests("FORCE_COLOR=0 cargo test --lib island"));
  for (const not of ["pip install pytest", "cat jest.config.js", "grep mocha package.json", "cat pytest.ini", "cargo build --tests"]) {
    assert.ok(!looksLikeTests(not), `${not} only names a runner`);
  }
  assert.deepEqual(testCounts("test result: ok. 3 passed; 1 failed\ntest result: ok. 2 passed; 0 failed"), { passed: 5, failed: 1 });
  assert.deepEqual(testCounts("ℹ tests 220\nℹ pass 218\nℹ fail 2"), { passed: 218, failed: 2 });
  assert.deepEqual(testCounts("Test Suites: 1 passed, 1 total\nTests:       2 failed, 48 passed, 50 total"), { passed: 48, failed: 2 });
  assert.deepEqual(testCounts(" Test Files  3 passed (3)\n      Tests  48 passed (48)"), { passed: 48, failed: null });
  assert.deepEqual(testCounts("===== 47 passed, 1 failed in 1.20s ====="), { passed: 47, failed: 1 });
  assert.deepEqual(testCounts("Compiling kyuren"), { passed: null, failed: null });
});
