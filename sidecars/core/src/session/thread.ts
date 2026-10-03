import type { Said } from "#agent/loop.ts";
import { paneIn } from "#session/panes.ts";
import type { Answered, Session, Sessions } from "#session/store.ts";

export type Thread = {
  session: Session | undefined;
  /// What was said before this turn. Empty for a turn that belongs to no session.
  history: Said[];
  /// Whether what was said before holds the user's notes.
  exposed: boolean;
};

/// Works out which session a turn belongs to, keeps the turn in it, and hands back what was said
/// before now.
///
/// Reading before keeping is the whole point of doing this in one place: the other way round, a
/// prompt arrives as its own context and the model is asked to answer a question it has just been
/// told the answer to.
export function opened(
  sessions: Sessions,
  asked: unknown,
  pane: unknown,
  prompt: string,
  title: string,
): Thread {
  let session: Session | undefined;

  if (typeof asked === "string" && asked.trim() !== "") {
    session = sessions.find(asked.trim());
    if (!session) throw new Error("that is not a session Kyuren holds");
  } else {
    const where = paneIn(pane);
    if (where) session = sessions.start(where, title);
  }

  if (!session) return { session: undefined, history: [], exposed: false };

  const history = sessions
    .read(session.id)
    .map((turn) => ({ role: turn.role, text: turn.text }));
  sessions.remember(session.id, "user", prompt);
  return { session, history, exposed: session.exposed === true };
}

/// Keeps what Kyuren said, and what said it, so the next turn in this session knows it, and whether
/// the turn read the user's notes, since what it said may now hold them.
export function answered(sessions: Sessions, thread: Thread, text: string, by?: Answered, exposed = false): void {
  if (!thread.session) return;
  sessions.remember(thread.session.id, "assistant", text, Date.now(), by);
  if (exposed) sessions.expose(thread.session.id);
}
