import { exec } from '@bakers-build/core';
import type { TicketMetric } from '../plugins/remote.js';

/** The `mr_changes` measurement (skill definition `mr-changes.json`). */
export interface MrChanges {
  score: number;
  files_changed: number;
  additions: number;
  deletions: number;
}

/** Definition order and units of the `mr_changes` values. */
const VALUES: [keyof MrChanges, string][] = [
  ['score', 'lines'],
  ['files_changed', 'count'],
  ['additions', 'lines'],
  ['deletions', 'lines'],
];

/** Sums `git diff --numstat` output; a binary file (`-`) counts as 0 lines. */
export function parseNumstat(text: string): MrChanges {
  let additions = 0;
  let deletions = 0;
  let files = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const [added = '', deleted = ''] = line.split('\t');
    additions += Number(added) || 0;
    deletions += Number(deleted) || 0;
    files += 1;
  }
  return {
    score: additions + deletions,
    files_changed: files,
    additions,
    deletions,
  };
}

/** The fixed-format `bb_metric` rows, one shared `recorded`. */
export function mrChangesRows(v: MrChanges, recorded: number): TicketMetric[] {
  return VALUES.map(([name, unit]) => ({
    name: `mr_changes.${name}`,
    value: v[name].toFixed(4),
    unit,
    recorded,
  }));
}

/**
 * Measures the ticket branch checked out in `worktreePath` against the merge
 * base with `origin/<baseBranch>` — the diff the merge request's Changes tab
 * shows. `HEAD`, not the remote branch: a merge deletes the remote branch.
 * With `branch`, `worktreePath` is the parent repository and the local branch
 * is measured: an isolated run's workspace has no Git on the host.
 */
export async function measureMrChanges(
  worktreePath: string,
  baseBranch: string,
  branch?: string,
): Promise<MrChanges> {
  await exec('git', ['fetch', 'origin', '--', baseBranch], {
    cwd: worktreePath,
  });
  const out = await exec(
    'git',
    [
      'diff',
      '--numstat',
      '-M',
      `origin/${baseBranch}...${branch ? `refs/heads/${branch}` : 'HEAD'}`,
    ],
    { cwd: worktreePath },
  );
  return parseNumstat(out);
}
