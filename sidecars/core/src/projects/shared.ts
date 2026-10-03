import { homedir } from "node:os";
import { join } from "node:path";
import { Board } from "#projects/board.ts";

/// Where the projects are. One folder holding one folder per project is the arrangement this is
/// built for, and it is the arrangement Kyuren's own author keeps.
const root = process.env.KYUREN_CODING ?? join(homedir(), "Documents", "Coding");

let held: Board | undefined;

export function sharedBoard(): Board {
  held ??= new Board(root);
  return held;
}
