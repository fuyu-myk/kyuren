import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

const HELPER = process.env.KYUREN_APPLE_HELPER
  ?? "sidecars/apple/.build/release/kyuren-apple";

/// Reading Apple's frameworks needs Swift, and the process that owns the brief is not Swift. A
/// short-lived helper is asked one question rather than a fourth process being supervised forever.
export async function apple<T>(args: string[]): Promise<T> {
  let stdout: string;
  try {
    ({ stdout } = await run(HELPER, args, { timeout: 20_000, maxBuffer: 8 << 20 }));
  } catch (failure) {
    const said = failure as { stdout?: string; message?: string };
    const reported = said.stdout ? explain(said.stdout) : undefined;
    throw new Error(reported ?? said.message ?? "the macOS helper did not run");
  }

  return JSON.parse(stdout) as T;
}

function explain(stdout: string): string | undefined {
  try {
    return (JSON.parse(stdout) as { error?: string }).error;
  } catch {
    return undefined;
  }
}

export type Access = { calendar: string; mail: string };

export async function access(): Promise<Access | undefined> {
  try {
    return await apple<Access>(["access"]);
  } catch {
    return undefined;
  }
}
