import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { acceptable, approvable, isName, named, parsePlaybook, type Playbook } from "#playbook/shape.ts";

export type Listed = { name: string; approved: boolean; pending: boolean };

/// The playbooks on disk: the approved ones, which a runner may read, and the pending ones,
/// which nothing may run. They are kept in different folders so that the difference is a fact
/// about where a file is rather than a flag that could be missed.
export class Playbooks {
  private readonly root: string;

  constructor(root: string) {
    this.root = root;
    mkdirSync(join(root, "pending"), { recursive: true });
  }

  private approvedPath(name: string): string {
    return join(this.root, `${named(name)}.md`);
  }

  private pendingPath(name: string): string {
    return join(this.root, "pending", `${named(name)}.md`);
  }

  list(): Listed[] {
    const approved = new Set(names(this.root));
    const pending = new Set(names(join(this.root, "pending")));
    return [...new Set([...approved, ...pending])]
      .sort()
      .map((name) => ({ name, approved: approved.has(name), pending: pending.has(name) }));
  }

  /// An approved playbook, or nothing. Pending ones are not readable this way by design.
  read(name: string): Playbook | undefined {
    const path = this.approvedPath(name);
    if (!existsSync(path)) return undefined;
    return parsePlaybook(readFileSync(path, "utf8"));
  }

  readPending(name: string): Playbook | undefined {
    const path = this.pendingPath(name);
    if (!existsSync(path)) return undefined;
    return parsePlaybook(readFileSync(path, "utf8"));
  }

  /// The approved playbook as written, for a repair to read and a person to see.
  text(name: string): string | undefined {
    const path = this.approvedPath(name);
    return existsSync(path) ? readFileSync(path, "utf8") : undefined;
  }

  /// Puts a new or repaired playbook in the pending folder, refusing what could never be approved
  /// and a repair that oversteps what a repair may do.
  propose(markdown: string): Playbook {
    const book = parsePlaybook(markdown);
    const may = approvable(book);
    if (!may.ok) throw new Error(`playbook ${book.name} cannot be approved: ${may.why}`);
    const before = this.read(book.name);
    if (before) {
      const fair = acceptable(before, book);
      if (!fair.ok) throw new Error(`playbook ${book.name} cannot be repaired that way: ${fair.why}`);
    }
    writeFileSync(this.pendingPath(book.name), withoutApproval(markdown), "utf8");
    return book;
  }

  /// Checked again here, since a pending file can be put in place by hand.
  approve(name: string, by: string): Playbook {
    const path = this.pendingPath(name);
    if (!existsSync(path)) throw new Error(`${name} has nothing pending`);
    const stamped = withApproval(readFileSync(path, "utf8"), `${by} on ${new Date().toISOString().slice(0, 10)}`);
    const book = parsePlaybook(stamped);
    const may = approvable(book);
    if (!may.ok) throw new Error(`playbook ${name} cannot be approved: ${may.why}`);
    const before = this.read(name);
    if (before) {
      const fair = acceptable(before, book);
      if (!fair.ok) throw new Error(`playbook ${name} cannot be repaired that way: ${fair.why}`);
    }
    writeFileSync(this.approvedPath(name), stamped, "utf8");
    rmSync(path);
    return book;
  }

  reject(name: string): void {
    rmSync(this.pendingPath(name), { force: true });
  }

  /// What the pending text changes against the approved one, line by line.
  diff(name: string): string {
    const before = existsSync(this.approvedPath(name)) ? readFileSync(this.approvedPath(name), "utf8") : "";
    const after = existsSync(this.pendingPath(name)) ? readFileSync(this.pendingPath(name), "utf8") : "";
    return lineDiff(before, after);
  }

  /// Renames an approved playbook's file, for a repair that changes the name; rare and explicit.
  rename(from: string, to: string): void {
    renameSync(this.approvedPath(from), this.approvedPath(to));
  }
}

function names(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((one) => one.endsWith(".md"))
    .map((one) => one.slice(0, -3))
    .filter(isName);
}

function withoutApproval(markdown: string): string {
  return markdown.replace(/^approved:.*\r?\n/m, "");
}

function withApproval(markdown: string, stamp: string): string {
  const clean = withoutApproval(markdown);
  return clean.replace(/^---\r?\n/, `---\napproved: ${stamp}\n`);
}

/// The smallest thing that reads as a diff: common lines by longest common subsequence, removed
/// lines with a minus, added lines with a plus.
export function lineDiff(before: string, after: string): string {
  const a = before.split("\n");
  const b = after.split("\n");
  const longest: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      longest[i]![j] = a[i] === b[j] ? longest[i + 1]![j + 1]! + 1 : Math.max(longest[i + 1]![j]!, longest[i]![j + 1]!);
    }
  }
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      out.push(` ${a[i]}`);
      i += 1;
      j += 1;
    } else if (j < b.length && (i >= a.length || longest[i]![j + 1]! >= longest[i + 1]![j]!)) {
      out.push(`+${b[j]}`);
      j += 1;
    } else {
      out.push(`-${a[i]}`);
      i += 1;
    }
  }
  return out.join("\n");
}
