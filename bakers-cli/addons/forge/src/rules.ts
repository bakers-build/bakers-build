// The forge tools' pure rules: which branches a run owns, where each merges,
// which PR/MR titles pass, and what never leaves a tool result.

/** `RULE` of `tests/contract/mr-title.sh`, verbatim (a test keeps them equal). */
export const CONVENTIONAL_TITLE_RULE =
  '^(feat|fix|chore|docs|refactor|test|ci|build|perf)(\\([a-z0-9._/-]+\\))?!?: [^[:space:]].*$';

const TITLE = new RegExp(
  CONVENTIONAL_TITLE_RULE.replace('[^[:space:]]', '\\S'),
);

export function isConventionalTitle(title: string): boolean {
  return TITLE.test(title);
}

export const TITLE_REFUSAL =
  'the title must be a Conventional Commits subject `type(scope)!: subject`, type one of feat, fix, chore, docs, refactor, test, ci, build, perf (e.g. `feat(cli): forge tools`)';

/** One ref component: no slash, no `..`, no trailing `.` or `.lock`. */
const SUFFIX = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

/** The run's own branch, or `<branch_name>-<suffix>`. */
export function isOwned(branch: string, branchName: string): boolean {
  if (branch === branchName) return true;
  if (!branch.startsWith(`${branchName}-`)) return false;
  const suffix = branch.slice(branchName.length + 1);
  return (
    SUFFIX.test(suffix) &&
    !suffix.includes('..') &&
    !suffix.endsWith('.') &&
    !suffix.endsWith('.lock')
  );
}

export function ownershipRefusal(branch: string, branchName: string): string {
  return `branch '${branch}' is not owned by this run: only '${branchName}' and '${branchName}-<suffix>' may be used`;
}

/** The ticket branch merges into `base_branch`; a variant into the ticket branch. */
export function derivedBase(
  branch: string,
  run: { branchName: string; baseBranch: string },
): string {
  return branch === run.branchName ? run.baseBranch : run.branchName;
}

/** Remove every secret and any Authorization header value. */
export function redact(text: string, secrets: readonly string[]): string {
  let out = text.replace(
    /(authorization:\s*)(?:\w+\s+)?\S+/gi,
    '$1[redacted]',
  );
  for (const secret of secrets)
    if (secret.length >= 4) out = out.split(secret).join('[redacted]');
  return out;
}
