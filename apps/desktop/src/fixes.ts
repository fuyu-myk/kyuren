/// What a new session is asked when checks fail on GitHub. Only the repository and a number go in:
/// a pull request's title or a branch's name is someone else's words, and a session takes its
/// request as the user's.
export function fixMain(repo: string): string {
  return `The checks on the newest commit of ${repo}'s default branch are failing on GitHub `
    + `(https://github.com/${repo}/commits). Find out why and fix them.`;
}

export function fixPull(repo: string, number: number): string {
  return `The checks on pull request #${number} in ${repo} are failing on GitHub `
    + `(https://github.com/${repo}/pull/${number}/checks). Find out why and fix them on its branch.`;
}
