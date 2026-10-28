import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { shownLines } from "#coding/shown.ts";

const run = promisify(execFile);

/// How long a request handed to a new session may be. The app keeps fourteen thousand characters
/// of one; a request spoken, typed or written for a failing check needs far fewer.
export const PROMPT_MOST = 4_000;

/// How a link is handed to the app that answers it.
export type Opener = (link: string) => Promise<void>;

/// The request a new session is handed, as the app will show it: trimmed, and refused when it is
/// too long or holds anything that would show differently from what the session is sent.
export function promptOf(prompt: string): string | undefined {
  const lines = shownLines(prompt.trim());
  return lines !== undefined && lines.length <= PROMPT_MOST ? lines : undefined;
}

/// The link the Claude app opens a new Claude Code session from, in one folder and with a request
/// in its prompt, built as the app's own "New Claude Code Session Here" builds it.
export function sessionLink(folder: string, prompt = ""): string {
  const asked = prompt === "" ? "" : `&q=${encodeURIComponent(prompt)}`;
  return `claude://code/new?folder=${encodeURIComponent(folder)}${asked}`;
}

export const openLink: Opener = async (link) => {
  await run("/usr/bin/open", [link], { timeout: 10_000 });
};
