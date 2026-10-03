import { mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import type { Tool } from "#agent/tool.ts";
import type { Action } from "#permission/action.ts";

/// A path as a person writes it, made absolute. A leading tilde is the home folder, since a
/// model told "~/.kyuren/vault" writes it back that way, and resolving it as a folder named "~"
/// left a stray copy of the vault inside whatever the process was started from.
const READ_MOST = 120_000;

export function at(path: string): string {
  const trimmed = path.trim();
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/")) return join(homedir(), trimmed.slice(2));
  return resolve(trimmed);
}

/// Where a path leads once its links are followed, spelled as the disk keeps it. A link with an
/// innocent name, or a spelling the disk folds into a secret's, is judged as the file it opens.
function real(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
}

/// What reading a path does: opens the file its links lead to, named as written as well when that
/// differs, since a secret's own folder can be a link to somewhere ordinary.
export function readOf(tool: string, path: string): Action {
  const written = at(path);
  const opened = real(written);
  return opened === written ? { tool, effect: "read", target: opened } : { tool, effect: "read", target: opened, through: written };
}

export const readFileSchema = z.object({
  path: z.string().describe("absolute path of the file to read"),
});

export const readFile: Tool<z.infer<typeof readFileSchema>> = {
  name: "read_file",
  description: "Read a text file from disk.",
  describe: (args) => readOf("read_file", args.path),
  // Enough for a long report to be read whole: a checker shown a note cut off mid sentence
  // cannot check the sentence.
  run: async (args) => readFileSync(at(args.path), "utf8").slice(0, READ_MOST),
};

export const listSchema = z.object({
  path: z.string().describe("absolute path of the directory to list"),
});

export const listDirectory: Tool<z.infer<typeof listSchema>> = {
  name: "list_directory",
  description: "List the entries of a directory.",
  describe: (args) => readOf("list_directory", args.path),
  run: async (args) => readdirSync(at(args.path)).slice(0, 500),
};

export const writeFileSchema = z.object({
  path: z.string().describe("absolute path of the file to write"),
  text: z.string().describe("the full contents to write"),
});

export const writeFile: Tool<z.infer<typeof writeFileSchema>> = {
  name: "write_file",
  description: "Write text to a file, replacing anything already there.",
  describe: (args) => ({ tool: "write_file", effect: "write", target: at(args.path) }),
  run: async (args) => {
    const path = at(args.path);
    // A note filed under a folder that does not exist yet is the ordinary case for a vault, so
    // the folders on the way are made rather than the write failing for want of them.
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, args.text, "utf8");
    return { written: path, bytes: args.text.length };
  },
};
