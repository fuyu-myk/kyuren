import { openLink, promptOf, sessionLink, type Opener } from "#coding/start.ts";
import type { Board } from "#projects/board.ts";
import { sharedBoard } from "#projects/shared.ts";

type Boarded = Pick<Board, "projects" | "reviews">;

/// Where every project stands. Asked for whenever the pane is looked at, so the board holds its
/// last reading for a moment rather than starting eighty processes each time.
export function projectHandlers(board: () => Boarded = sharedBoard, open: Opener = openLink) {
  return {
    "projects.board": async (params: Record<string, unknown>) => ({
      projects: await board().projects(params.fresh === true),
      reviews: board().reviews(),
    }),
    // Only a folder the board already lists: the link opens a session wherever it points.
    "projects.start": async (params: Record<string, unknown>) => {
      const found = (await board().projects()).find((one) => one.path === params.path);
      if (!found) throw new Error("that is not a project on the board");
      const asked = params.prompt ?? "";
      const prompt = typeof asked === "string" ? promptOf(asked) : undefined;
      if (prompt === undefined) throw new Error("that request cannot be handed to a session as it is");
      await open(sessionLink(found.path, prompt));
      return { started: true };
    },
  };
}
