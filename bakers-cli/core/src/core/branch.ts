/**
 * Refuses a branch name git could misread: `git check-ref-format` rules on
 * [A-Za-z0-9._/-], and no leading `-` that git reads as an option. Mirrors the
 * server's branch-name constraint; checked again here because the value comes
 * from the server.
 */
export function validateBranch(branch: string): void {
  if (
    !/^(?![-.])(?!.*(\.\.|\/\/|\/\.|\.lock(\/|$)))[A-Za-z0-9._/-]+(?<![/.])$/.test(
      branch,
    )
  ) {
    throw new Error(`invalid branch: ${branch}`);
  }
}
