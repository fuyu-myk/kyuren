import { homedir } from "node:os";
import { join } from "node:path";
import { Sessions } from "#session/store.ts";

const root = process.env.KYUREN_HOME ?? join(homedir(), ".kyuren");

let held: Sessions | undefined;

/// One store for the process. Sessions are the one thing here that cannot be rebuilt from
/// anything else, so two stores would mean two halves of a conversation.
export function sharedSessions(): Sessions {
  held ??= new Sessions(process.env.KYUREN_SESSIONS ?? join(root, "sessions.db"));
  return held;
}
