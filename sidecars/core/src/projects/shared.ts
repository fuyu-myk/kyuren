import { homedir } from "node:os";
import { join } from "node:path";
import { Board } from "#projects/board.ts";
import { decisionsAt } from "#projects/decisions.ts";
import { githubAt, reviewsWaiting } from "#projects/github.ts";

/// Where the projects are. One folder holding one folder per project is the arrangement this is
/// built for, and it is the arrangement Kyuren's own author keeps.
const root = process.env.KYUREN_CODING ?? join(homedir(), "Documents", "Coding");

/// Kyuren's own folder, where what was decided about each project is kept, and how many of a
/// project's decisions the board shows.
const kyuren = process.env.KYUREN_HOME ?? join(homedir(), ".kyuren");
const LATEST = 3;

let held: Board | undefined;

export function sharedBoard(): Board {
  held ??= new Board(root, { github: githubAt, decided: (path) => decisionsAt(kyuren, path, LATEST), reviews: reviewsWaiting });
  return held;
}
