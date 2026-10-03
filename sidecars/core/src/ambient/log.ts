import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Firing } from "#ambient/match.ts";

/// The presence log: one line per thing that reached the user unasked, with the rule or schedule
/// that caused it. The looking and the running both write it, and one file holds both, so a week
/// of it answers what Kyuren did on its own.
export function appendFiring(path: string, firing: Firing): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(firing)}\n`);
}

/// The most recent firings, newest first.
export function recentFirings(path: string, limit: number): Firing[] {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .slice(-limit)
    .reverse()
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Firing];
      } catch {
        return [];
      }
    });
}
