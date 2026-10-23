import { lstatSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, normalize, relative } from "node:path";
import { z } from "zod";

/// Any control or format character, and any blank wider or stranger than a space: a line break, a
/// terminal escape, a direction override, a zero-width or a wide space, a filler or a mark such as a
/// variation selector drawn as nothing, each of which can make what is shown differ from what would
/// run. The spaces that only differ from a plain one in where a line may break are as plain, and the
/// Mac names screenshots with one.
export const HIDING = /(?![   ])[\p{C}\p{Z}\p{Default_Ignorable_Code_Point}ᅟᅠ⠀ㅤﾠ]/u;

/// Text of many lines, a plan or a change, as it is shown: its lines and tabs are what it is made
/// of, whichever way its lines end, and anything else hidden in it keeps it off the island.
export function shownLines(text: string): string | undefined {
  const lines = text.replaceAll("\r\n", "\n");
  return HIDING.test(lines.replaceAll("\n", " ").replaceAll("\t", " ")) ? undefined : lines;
}

const REQUEST = z.object({
  session_id: z.string().min(1).max(200),
  cwd: z.string().min(1).max(4096),
  tool_name: z.string().min(1).max(200),
  tool_input: z.record(z.string(), z.unknown()).default({}),
});

/// What Claude Code sends a hook about a tool it is about to use.
export type Request = z.infer<typeof REQUEST>;

export function requestOf(payload: unknown): Request | undefined {
  const request = REQUEST.safeParse(payload);
  return request.success ? request.data : undefined;
}

export function text(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  return typeof value === "string" ? value : "";
}

/// Where a path leads once its links are followed, spelled as the disk keeps it: a link in the
/// project to a file outside it is shown as that file, since what is answered is about that file.
export function real(path: string): string {
  if (!isAbsolute(path)) return path;
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
}

/// Where a write to a path would land once its links are followed, and whether nothing is there yet:
/// a new file in a linked folder lands where the link leads. Nothing when that cannot be told for
/// certain, for a path not given whole from the root, one with a step back or in place, or one
/// through a link that leads nowhere, which the write would follow.
export function landing(path: string): { path: string; fresh: boolean } | undefined {
  if (!isAbsolute(path) || normalize(path) !== path || (path !== "/" && path.endsWith("/"))) return undefined;
  let there = path;
  const after: string[] = [];
  for (;;) {
    try {
      lstatSync(there);
      break;
    } catch {
      if (there === dirname(there)) return undefined;
      after.unshift(basename(there));
      there = dirname(there);
    }
  }
  try {
    return { path: join(realpathSync.native(there), ...after), fresh: after.length > 0 };
  } catch {
    return undefined;
  }
}

export function placed(path: string, cwd: string): string {
  const inside = relative(cwd, path);
  return path && !inside.startsWith("..") && !inside.startsWith("/") ? inside : path;
}

/// The project a question comes from, named by its folder, or nothing when the name hides something.
export function projectOf(cwd: string): string | undefined {
  const project = basename(cwd);
  return HIDING.test(project) ? undefined : project;
}
