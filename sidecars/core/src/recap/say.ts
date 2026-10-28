import { clock } from "#brief/day.ts";
import type { Recap } from "#recap/gather.ts";

/// How many of a project's commits are listed; the rest are counted.
const LISTED = 5;
/// How many projects are named out loud.
const NAMED = 3;
const LONGEST = 200;

function count(many: number, one: string): string {
  return `${many} ${one}${many === 1 ? "" : "s"}`;
}

function list(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

/// Something written elsewhere, as one line of the note: what a commit or a title says cannot end
/// the block it is written in, nor run on.
function plain(text: string): string {
  return text.replaceAll("<!--", "").replaceAll("-->", "").replace(/\s+/g, " ").trim().slice(0, LONGEST);
}

function section(heading: string, lines: string[]): string[] {
  return lines.length > 0 ? [`### ${heading}`, ...lines, ""] : [];
}

/// The evening's section of the day's note.
export function recapNote(recap: Recap): string {
  const quiet = recap.committed.length + recap.merged.length + recap.made.length + recap.worked.length === 0;
  const lines = [
    "## Evening",
    "",
    ...section("Committed", recap.committed.map((one) => {
      const more = one.said.length > LISTED ? `; and ${one.said.length - LISTED} more` : "";
      return `- **${one.project}**, ${count(one.said.length, "commit")}: ${one.said.slice(0, LISTED).map(plain).join("; ")}${more}`;
    })),
    ...section("Merged", recap.merged.map((one) => `- [${one.repo}#${one.number}](${one.url}) ${plain(one.title)}`)),
    ...section("Decided", recap.made.map((one) => `- **${one.project}**, ${plain(one.topic)}: ${plain(one.said)}`)),
    ...section("Claude Code", recap.worked.map((one) => `- **${one.project}**, ${count(one.sessions, "session")}`)),
    ...(quiet ? ["Nothing committed, merged or decided today, and no Claude Code session.", ""] : []),
    ...(recap.missing.includes("GitHub") ? ["_GitHub could not be asked, so merged pull requests are not here._"] : []),
    `_Written at ${clock(new Date(recap.at).toISOString())}._`,
  ];
  return lines.join("\n");
}

/// The evening said out loud, from the facts rather than retold by a model, as the morning is.
export function recapSpeech(recap: Recap): string {
  const parts: string[] = [];
  const commits = recap.committed.reduce((sum, one) => sum + one.said.length, 0);
  if (commits > 0) {
    const where = recap.committed.length === 1
      ? `in ${recap.committed[0]!.project}`
      : list(recap.committed.slice(0, NAMED).map((one) => `${one.said.length} in ${one.project}`));
    parts.push(`You made ${count(commits, "commit")} today, ${where}.`);
  }
  if (recap.merged.length > 0) {
    const which = list(recap.merged.slice(0, NAMED).map((one) => `${one.repo.split("/")[1]} number ${one.number}`));
    parts.push(`${count(recap.merged.length, "pull request")} merged, ${which}.`);
  }
  if (recap.made.length > 0) {
    const about = list([...new Set(recap.made.map((one) => one.project))].slice(0, NAMED));
    parts.push(`${count(recap.made.length, "decision")} on the island, about ${about}.`);
  }
  if (recap.worked.length > 0) {
    const sessions = recap.worked.reduce((sum, one) => sum + one.sessions, 0);
    const all = recap.worked.length === 1 ? count(sessions, "session") : `${count(sessions, "session")} in all`;
    parts.push(`Claude Code worked in ${list(recap.worked.slice(0, NAMED).map((one) => one.project))}, ${all}.`);
  }
  if (parts.length === 0) parts.push("Nothing was committed, merged or decided today, and no Claude Code session ran.");
  if (recap.missing.includes("GitHub")) parts.push("GitHub could not be asked, so merged pull requests are not counted.");
  return parts.join(" ");
}
