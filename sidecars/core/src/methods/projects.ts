import { sharedBoard } from "#projects/shared.ts";

/// Where every project stands. Asked for whenever the pane is looked at, so the board holds its
/// last reading for a moment rather than starting eighty processes each time.
export function projectHandlers() {
  return {
    "projects.board": async (params: Record<string, unknown>) => ({
      projects: await sharedBoard().projects(params.fresh === true),
    }),
  };
}
