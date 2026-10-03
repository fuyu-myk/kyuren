import { homedir } from "node:os";
import { join } from "node:path";
import { Skills } from "#skill/store.ts";

const root = process.env.KYUREN_HOME ?? join(homedir(), ".kyuren");

let held: Skills | undefined;

/// One store for the process. What a skill is allowed to do is read from here at the moment of
/// every call, so there must be exactly one answer to that question.
export function sharedSkills(): Skills {
  held ??= new Skills(process.env.KYUREN_SKILLS ?? join(root, "skills.db"));
  return held;
}
