import { ROUTES } from "#model/route.ts";
import { paneIn, PANES } from "#session/panes.ts";
import { sharedSessions } from "#session/shared.ts";

function idIn(params: Record<string, unknown>): string {
  const id = params.id;
  if (typeof id !== "string" || id.trim() === "") throw new Error("that needs a session");
  return id.trim();
}

/// Conversations, kept. A pane organises its own; the hub sees all of them at once.
export function sessionHandlers() {
  const sessions = sharedSessions();

  return {
    "session.panes": async () => ({ panes: PANES }),

    "session.list": async (params: Record<string, unknown>) => {
      const pane = paneIn(params.pane);
      const limit = typeof params.limit === "number" ? params.limit : 50;
      return { sessions: pane ? sessions.inPane(pane, limit) : sessions.list(limit) };
    },

    "session.read": async (params: Record<string, unknown>) => {
      const id = idIn(params);
      const session = sessions.find(id);
      if (!session) throw new Error("that is not a session Kyuren holds");
      return { session, turns: sessions.read(id) };
    },

    "session.start": async (params: Record<string, unknown>) => {
      const pane = paneIn(params.pane);
      if (!pane) throw new Error("a session belongs to one of the panes");
      const title = typeof params.title === "string" ? params.title.trim() : "";
      return { session: sessions.start(pane, title === "" ? "new session" : title) };
    },

    "session.prefer": async (params: Record<string, unknown>) => {
      const route = ROUTES.find((one) => one === params.route);
      if (params.route != null && !route) throw new Error("that is not a route Kyuren has");
      sessions.prefer(idIn(params), route);
      return { preferred: route ?? null };
    },

    "session.rename": async (params: Record<string, unknown>) => {
      const title = typeof params.title === "string" ? params.title.trim() : "";
      if (title === "") throw new Error("a session needs something to be called");
      sessions.rename(idIn(params), title);
      return { renamed: true };
    },

    "session.forget": async (params: Record<string, unknown>) => {
      sessions.forget(idIn(params));
      return { forgotten: true };
    },
  };
}
