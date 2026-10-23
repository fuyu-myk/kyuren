import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { processAlive } from "#coding/alive.ts";

/// When this process began, as Claude Code writes it in a session's file.
function began(): string {
  return execFileSync("/bin/ps", ["-o", "lstart=", "-p", String(process.pid)], { env: { ...process.env, TZ: "UTC", LC_ALL: "C" } })
    .toString()
    .trim();
}

test("a session's process is known for the one that began when its file says, whatever language Kyuren was started in", async () => {
  const was = { LANG: process.env.LANG, LC_ALL: process.env.LC_ALL };
  // Singapore's English writes the day before the month, as a Mac set to it starts Kyuren with.
  process.env.LANG = "en_SG.UTF-8";
  process.env.LC_ALL = "en_SG.UTF-8";
  try {
    assert.equal(await processAlive()(process.pid, began()), true);
    assert.equal(await processAlive()(process.pid, "Thu Jan  1 00:00:00 1970"), false, "a process number given out again");
  } finally {
    for (const [name, value] of Object.entries(was)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
