import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Recorder } from "#permission/gate.ts";

/// Written synchronously and appended, never rewritten. An audit trail that can be lost in a crash
/// or edited in place is not one.
export function fileRecorder(path: string): Recorder {
  mkdirSync(dirname(path), { recursive: true });
  return (entry) => {
    appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf8");
  };
}
