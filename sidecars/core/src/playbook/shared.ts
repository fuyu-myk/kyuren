import { homedir } from "node:os";
import { join } from "node:path";
import { RunLog } from "#playbook/runlog.ts";
import { Playbooks } from "#playbook/store.ts";

const root = process.env.KYUREN_HOME ?? join(homedir(), ".kyuren");

let books: Playbooks | undefined;
let runs: RunLog | undefined;

/// Beside the vault, not in it: a procedure is not a note and a run is not a memory.
export function sharedPlaybooks(): Playbooks {
  books ??= new Playbooks(join(root, "playbooks"));
  return books;
}

export function sharedRuns(): RunLog {
  runs ??= new RunLog(join(root, "runs"));
  return runs;
}

export function home(): string {
  return homedir();
}
