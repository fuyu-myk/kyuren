import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Alive } from "#coding/claude.ts";

const run = promisify(execFile);

/// When a process began, written as the session files write it: ps's start time, in UTC.
async function startOf(pid: number): Promise<string | undefined> {
  try {
    const { stdout } = await run("/bin/ps", ["-o", "lstart=", "-p", String(pid)], {
      env: { ...process.env, TZ: "UTC" },
      timeout: 2_000,
    });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

const squeezed = (text: string) => text.replace(/\s+/g, " ").trim();

/// A process is the one that wrote its file if it is alive and began when the file says it did,
/// since a process number is given out again once its owner has gone. The answer is asked of ps
/// once per process number and start, so a number given out again is asked about afresh.
export function processAlive(): Alive {
  const matched = new Map<string, boolean>();
  return async (pid, procStart) => {
    try {
      process.kill(pid, 0);
    } catch (failure) {
      if ((failure as NodeJS.ErrnoException).code !== "EPERM") {
        for (const key of matched.keys()) if (key.startsWith(`${pid}|`)) matched.delete(key);
        return false;
      }
    }
    if (!procStart) return true;
    const key = `${pid}|${squeezed(procStart)}`;
    if (!matched.has(key)) {
      const seen = await startOf(pid);
      matched.set(key, seen === undefined || squeezed(seen) === squeezed(procStart));
    }
    return matched.get(key) ?? true;
  };
}
