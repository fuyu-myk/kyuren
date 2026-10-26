import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";

const run = promisify(execFile);

/// How a commit's checks stand, as GitHub rolls them up and shows them: failing once any has
/// failed, pending while any still runs, passing once all have passed, none when there are none.
export type Checks = "passing" | "failing" | "pending" | "none";

/// An open pull request, as the board shows it.
export type Pull = { number: number; title: string; url: string; draft: boolean; checks: Checks };

/// A repository on GitHub as the board shows it: its open pull requests, the last updated first,
/// how many there are in all, and how the checks on its main branch's newest commit stand.
export type GitHub = { repo: string; branch?: string; main: Checks; count: number; pulls: Pull[] };

/// How many pull requests are shown for each repository; the rest are counted.
const SHOWN = 10;
/// Long enough for a slow network, short enough that one stuck call does not hold up the rest.
const PATIENCE = 15_000;

/// A repository's place on GitHub, owner and name, from where its origin points, or nothing for one
/// kept elsewhere or named in a way GitHub does not name repositories.
export function githubOf(remote: string): string | undefined {
  const found = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/.exec(remote.trim());
  return found ? `${found[1]}/${found[2]}` : undefined;
}

const ROLLUP = z.object({ state: z.string() }).nullable().optional();

const ANSWER = z.object({
  data: z.object({
    repository: z
      .object({
        defaultBranchRef: z.object({ name: z.string(), target: z.object({ statusCheckRollup: ROLLUP }).nullable().optional() }).nullable(),
        pullRequests: z.object({
          totalCount: z.number().int().min(0),
          nodes: z.array(
            z.object({
              number: z.number().int().positive(),
              title: z.string().max(500),
              url: z.string(),
              isDraft: z.boolean(),
              commits: z.object({ nodes: z.array(z.object({ commit: z.object({ statusCheckRollup: ROLLUP }) })) }),
            }),
          ),
        }),
      })
      .nullable(),
  }),
});

function checksOf(rollup: z.infer<typeof ROLLUP>): Checks {
  if (!rollup) return "none";
  if (rollup.state === "SUCCESS") return "passing";
  if (rollup.state === "FAILURE" || rollup.state === "ERROR") return "failing";
  return "pending";
}

/// What GitHub answered, as the board shows it, or nothing for an answer that is not one: an error,
/// or a repository it does not show this user. A link that does not lead to the repository's own
/// pull request on GitHub is left out, since the board opens it.
export function readGitHub(answer: unknown, repo: string): GitHub | undefined {
  const read = ANSWER.safeParse(answer);
  const found = read.success ? read.data.data.repository : null;
  if (!found) return undefined;
  const own = `https://github.com/${repo}/pull/`;
  const pulls = found.pullRequests.nodes
    .filter((one) => one.url === `${own}${one.number}`)
    .map((one) => ({ number: one.number, title: one.title, url: one.url, draft: one.isDraft, checks: checksOf(one.commits.nodes[0]?.commit.statusCheckRollup) }));
  const branch = found.defaultBranchRef;
  return { repo, ...(branch ? { branch: branch.name } : {}), main: checksOf(branch?.target?.statusCheckRollup), count: found.pullRequests.totalCount, pulls };
}

const QUERY = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    defaultBranchRef { name target { ... on Commit { statusCheckRollup { state } } } }
    pullRequests(states: OPEN, first: ${SHOWN}, orderBy: { field: UPDATED_AT, direction: DESC }) {
      totalCount
      nodes { number title url isDraft commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } }
    }
  }
}`;

/// Where a repository on this Mac stands on GitHub, asked of GitHub through its own command line,
/// signed in as the user; nothing for one not on GitHub, or when GitHub cannot be asked.
export async function githubAt(path: string): Promise<GitHub | undefined> {
  const remote = await run("git", ["-C", path, "remote", "get-url", "origin"], { timeout: PATIENCE }).then(
    (done) => done.stdout,
    () => "",
  );
  const repo = githubOf(remote);
  if (!repo) return undefined;
  const [owner, name] = repo.split("/");
  // Each passed as plain text: the typed form would read a repository named "123" as a number.
  const asked = await run("gh", ["api", "graphql", "-f", `query=${QUERY}`, "-f", `owner=${owner}`, "-f", `name=${name}`], { timeout: PATIENCE, maxBuffer: 2_000_000 }).catch(() => undefined);
  if (!asked) return undefined;
  try {
    return readGitHub(JSON.parse(asked.stdout), repo);
  } catch {
    return undefined;
  }
}
