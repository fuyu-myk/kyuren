import { basename } from "node:path";

const RUNNERS = new Set(["pytest", "jest", "vitest", "mocha", "rspec", "phpunit"]);
const TOOLS = new Set(["cargo", "npm", "pnpm", "yarn", "bun", "deno", "go", "swift", "make", "mix", "dotnet", "xcodebuild"]);
/// Words that only run what follows them.
const WRAPPERS = new Set(["npx", "pnpx", "bunx", "env", "time", "exec"]);

/// Whether one command, a segment of a line, runs tests: what it runs is its first word past any
/// settings and wrappers, so a runner merely named, installed or read is not one.
function runsTests(segment: string): boolean {
  const words = segment.trim().replace(/^\(+/, "").split(/\s+/).filter(Boolean);
  let at = 0;
  while (at < words.length && /^\w+=/.test(words[at] ?? "")) at += 1;
  for (;;) {
    const word = basename(words[at] ?? "");
    if (WRAPPERS.has(word)) at += 1;
    else if (/^python3?$/.test(word) && words[at + 1] === "-m") at += 2;
    else if ((word === "uv" || word === "poetry") && words[at + 1] === "run") at += 2;
    else break;
  }
  const command = basename(words[at] ?? "");
  if (RUNNERS.has(command)) return true;
  if (command === "node") return words.slice(at + 1).some((word) => word === "--test");
  if (!TOOLS.has(command)) return false;
  // A flag's own value may come before the word that says to test; any other word is another task.
  let value = false;
  for (const word of words.slice(at + 1)) {
    if (word === "test" || word.startsWith("test:")) return true;
    if (word.startsWith("-")) value = !word.includes("=");
    else if (value) value = false;
    else if (word !== "run") return false;
  }
  return false;
}

export function looksLikeTests(command: string): boolean {
  return command.split(/&&|\|\||[;|\n]/).some(runsTests);
}

/// How many passed and failed, from what a test run printed, however its runner says it: added up
/// over every crate or file it reports, leaving out the counts of files and suites beside tests.
export function testCounts(output: string): { passed: number | null; failed: number | null } {
  let passed: number | null = null;
  let failed: number | null = null;
  const add = (now: number | null, more: string | undefined) => (more === undefined ? now : (now ?? 0) + Number(more));
  for (const line of output.split("\n")) {
    if (/Test (Files|Suites)/.test(line)) continue;
    const node = /^[ℹ#]\s+(pass|fail)\s+(\d+)\s*$/.exec(line.trim());
    if (node) {
      if (node[1] === "pass") passed = add(passed, node[2]);
      else failed = add(failed, node[2]);
      continue;
    }
    for (const found of line.matchAll(/(\d+)\s+passed/g)) passed = add(passed, found[1]);
    for (const found of line.matchAll(/(\d+)\s+failed/g)) failed = add(failed, found[1]);
  }
  return { passed, failed };
}
