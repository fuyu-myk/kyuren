import { homedir } from "node:os";
import { join } from "node:path";
import { places as notionPlaces } from "#connect/notion/places.ts";
import { vaults } from "#memory/vaults.ts";
import { fileKeeper } from "#permission/answers.ts";
import { fileRecorder } from "#permission/audit.ts";
import type { Place } from "#permission/action.ts";
import { Gate } from "#permission/gate.ts";

const root = process.env.KYUREN_HOME ?? join(homedir(), ".kyuren");

let held: Gate | undefined;

/// Folders no tool may write into, however the model asks. A playbook becomes approved by
/// approval and nothing else, and a run log is written by the run and nothing else; a write
/// there through a file tool would be a way past both, so it is refused rather than asked about.
/// So is all of Kyuren's own folder, which holds what the user allowed, which vaults may be
/// written, the skills approved and the rules that may read unattended: one yes to a write there
/// would grant what only the user grants. The vault inside it is a place of its own, and decides.
export function guarded(): Place[] {
  return [
    { path: join(root, "playbooks"), mode: "read" },
    { path: join(root, "runs"), mode: "read" },
    { path: root, mode: "read", own: true },
  ];
}

/// One gate for the process. What was approved during a turn is what is approved for anything
/// that reads on its own later; two gates would mean being asked twice for the same thing. What
/// the user allowed is kept in answers.json beside the audit, so a restart does not ask again.
export function sharedGate(): Gate {
  held ??= new Gate(
    () => [...vaults(), ...notionPlaces(), ...guarded()],
    fileRecorder(join(root, "audit.jsonl")),
    fileKeeper(join(root, "answers.json")),
  );
  return held;
}
