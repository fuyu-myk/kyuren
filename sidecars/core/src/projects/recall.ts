import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Project } from "#projects/state.ts";

const run = promisify(execFile);

/// How many commits back is enough to say what was being worked on, and how much of a readme is
/// enough to say what a project is.
const BACK = 8;
const BLURB = 400;

export type Recalled = {
  project: Project;
  /// What the project says it is, in its own words.
  about?: string;
  /// The last few commits, newest first.
  lately: Array<{ at: number; said: string }>;
};

/// Which project someone means. An exact name wins; otherwise the one whose name starts with what
/// was asked, and failing that the one that contains it, most recently worked on first.
export function matched(projects: Project[], asked: string): Project | undefined {
  const looking = asked.trim().toLowerCase();
  if (looking === "") return undefined;

  return (
    projects.find((one) => one.name.toLowerCase() === looking)
    ?? projects.find((one) => one.name.toLowerCase().startsWith(looking))
    ?? projects.find((one) => one.name.toLowerCase().includes(looking))
    ?? projects.find((one) => looking.includes(one.name.toLowerCase()))
  );
}

/// The first paragraph of a readme, which is where a project says what it is.
export function opening(readme: string): string | undefined {
  for (const part of readme.split(/\n\s*\n/)) {
    const said = part
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#") && !line.startsWith("!["))
      .join(" ")
      .trim();
    if (said.length > 0) return said.slice(0, BLURB);
  }
  return undefined;
}

async function readme(path: string): Promise<string | undefined> {
  for (const name of ["README.md", "readme.md", "README.markdown", "README"]) {
    try {
      return opening(await readFile(join(path, name), "utf8"));
    } catch {
      // The next candidate, or none: a project without a readme still has its commits.
    }
  }
  return undefined;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function on(at: number): string {
  const day = new Date(at);
  return `${day.getDate()} ${MONTHS[day.getMonth()]} ${day.getFullYear()}`;
}

function counted(many: number, thing: string): string {
  return `${many} ${thing}${many === 1 ? "" : "s"}`;
}

/// What was happening when work stopped, said in full.
///
/// Composed here rather than left to the model to assemble: a report of facts is not improved by
/// being retold, and the part that matters most to someone returning after six months is what the
/// last few commits were about.
export function summarise(held: Recalled): string {
  const said: string[] = [];
  const { project } = held;

  said.push(held.about ? `${project.name} is ${held.about}` : project.name);

  const standing: string[] = [`on the ${project.branch} branch`];
  if (project.dirty > 0) standing.push(`${counted(project.dirty, "file")} uncommitted`);
  if (project.ahead > 0) standing.push(`${counted(project.ahead, "commit")} unpushed`);
  if (project.behind > 0) standing.push(`${counted(project.behind, "commit")} behind`);
  if (project.upstream === undefined) standing.push("never pushed anywhere");

  said.push(
    project.lastAt
      ? `Work stopped on ${on(project.lastAt)}, ${standing.join(", ")}.`
      : `Nothing has been committed yet, ${standing.join(", ")}.`,
  );

  if (held.lately.length > 0) {
    const last = held.lately.slice(0, 5).map((one) => one.said).filter((one) => one !== "");
    if (last.length > 0) {
      said.push(`The last thing being worked on: ${last.join("; ")}.`);
    }
  }

  return said.join(". ").replace(/\.\./g, ".");
}

export async function recall(project: Project): Promise<Recalled> {
  const [about, log] = await Promise.all([
    readme(project.path),
    run("git", ["-C", project.path, "log", `-${BACK}`, "--format=%ct%x1f%s"], {
      timeout: 8_000,
    })
      .then(({ stdout }) => stdout)
      .catch(() => ""),
  ]);

  const lately = log
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const [when, said] = line.split(String.fromCharCode(31));
      return { at: Number(when) * 1000, said: (said ?? "").trim() };
    })
    .filter((one) => Number.isFinite(one.at) && one.at > 0);

  return { project, about, lately };
}
