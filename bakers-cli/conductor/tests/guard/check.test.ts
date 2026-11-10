// The run guard's rule table: each row is a command an agent run may try and
// whether the guard lets it through (AC-1 to AC-5).
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkCommand, type GuardContext } from '../../src/guard/check.js';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'bb-guard-')));
const worktree = join(root, 'repo', '.bakers-worktrees', 'feat', 'x-1');
const tmp = join(root, 'tmp');
const home = join(root, 'home');
mkdirSync(join(worktree, '.ddev'), { recursive: true });
mkdirSync(join(worktree, 'build'), { recursive: true });
mkdirSync(tmp, { recursive: true });
mkdirSync(home, { recursive: true });
writeFileSync(join(worktree, '.ddev', 'config.yaml'), 'name: x-1\n');

const ctx: GuardContext = {
  cwd: worktree,
  worktree,
  tmpdir: tmp,
  home,
  branch: 'feat/x-1',
  ddevProject: 'x-1',
};

function denied(command: string, at: Partial<GuardContext> = {}) {
  const d = checkCommand(command, { ...ctx, ...at });
  return d.allow ? null : d.rule;
}

describe('git push (AC-1, AC-5)', () => {
  it.each([
    'git push',
    'git push -u origin HEAD',
    'git push origin feat/x-1',
    'git push origin HEAD:feat/x-1',
    'git push origin HEAD:refs/heads/feat/x-1',
    'git push --set-upstream origin feat/x-1-v2',
    'git status && git push origin feat/x-1',
  ])('allows %s', (command) => {
    expect(denied(command)).toBeNull();
  });

  it.each([
    'git push --force',
    'git push -f origin feat/x-1',
    'git push -uf origin feat/x-1',
    'git push --force-with-lease origin feat/x-1',
    'git push --force-with-lease=feat/x-1 origin feat/x-1',
    'git push --force-if-includes origin feat/x-1',
    'git push origin +feat/x-1',
    'git push origin --delete feat/x-1',
    'git push -d origin other',
    'git push origin :other',
    'git push origin :refs/tags/v1',
    'git push --mirror',
    'git push --all origin',
    'git push --tags',
    'git push --prune origin',
    'git push origin other',
    'git push origin main',
    'git push origin HEAD:main',
    'git push upstream feat/x-1',
    'git push https://example.com/r.git feat/x-1',
    'git -C /elsewhere push origin feat/x-1',
    'git push origin $BRANCH',
  ])('refuses %s', (command) => {
    expect(denied(command)).not.toBeNull();
  });
});

describe('git discarding work (AC-2)', () => {
  it.each([
    'git branch -d feat/x-1',
    'git branch -a',
    'git reset --hard',
    'git reset --hard HEAD~1',
    'git clean -fdx',
    'git checkout -- src/a.ts',
    'git restore src/a.ts',
    `git worktree remove ${worktree}`,
    'git update-ref -d refs/heads/feat/x-1',
    'git stash list',
  ])('allows %s', (command) => {
    expect(denied(command)).toBeNull();
  });

  it.each([
    'git branch -D other',
    'git branch --delete other',
    'git branch -d feat/x-1 main',
    'git worktree remove ../x-2',
    'git worktree remove --force /elsewhere',
    'git update-ref -d refs/heads/other',
    'git -C /elsewhere reset --hard',
    'git --work-tree=/elsewhere clean -fdx',
    'git --git-dir=/elsewhere/.git reset --hard',
    'cd .. && git reset --hard',
    'git restore ../x-2/a.ts',
    'git checkout -- /etc/hosts',
    'git stash drop',
    'git stash clear',
  ])('refuses %s', (command) => {
    expect(denied(command)).not.toBeNull();
  });
});

describe('file deletion (AC-3)', () => {
  it.each([
    'rm -rf build/',
    'rm -rf build/*',
    'rm a.txt b.txt',
    `rm ${tmp}/x`,
    'rm $TMPDIR/x',
    'rm "$TMPDIR/x"',
    'rmdir build',
    'unlink build/a',
    'find . -name "*.log" -delete',
    'find build -exec rm {} \\;',
    'find / -name x',
    'cd build && rm -r out',
    'bash -c "rm -rf build"',
    'ls ~ && echo $FOO',
  ])('allows %s', (command) => {
    expect(denied(command)).toBeNull();
  });

  it.each([
    'rm -rf ~/x',
    'rm -rf ~',
    'rm $HOME/.zshrc',
    'rm ../x',
    'rm -rf /',
    'rm -- -x ../y',
    'cd .. && rm -r x',
    'cd $FOO && rm x',
    'bash -c "rm /etc/x"',
    "sh -c 'cd /; rm -rf x'",
    'sudo rm /etc/hosts',
    'env FOO=1 rm /etc/hosts',
    'rm $FOO/x',
    'rm $(pwd)/../x',
    'rm `pwd`/../x',
    'rm ../*',
    'shred -u /etc/x',
    'unlink /etc/x',
    'rmdir ../x-2',
    'find / -delete',
    'find .. -name x -delete',
    'find ~ -exec rm -f {} +',
    'ls | xargs rm',
    'true; rm /etc/hosts',
    'echo ok\nrm /etc/hosts',
  ])('refuses %s', (command) => {
    expect(denied(command)).not.toBeNull();
  });

  it('names an unresolvable target as such', () => {
    expect(denied('rm $FOO/x')).toBe('unresolvable');
  });
});

describe('DDEV and forge (AC-4)', () => {
  it.each([
    'ddev delete -Oy',
    'ddev delete -Oy x-1',
    'ddev stop --remove-data',
    'ddev start',
    'ddev exec drush cr',
    'gh pr view 1',
    'gh pr create --fill',
    'glab mr create --fill',
    'gh api repos/o/r/pulls',
  ])('allows %s', (command) => {
    expect(denied(command)).toBeNull();
  });

  it.each([
    'ddev delete other -y',
    'ddev delete --all -y',
    'ddev stop --remove-data other',
    'ddev stop --all --remove-data',
    ['ddev delete -Oy', { cwd: home }],
    'gh pr close 1',
    'gh pr merge 1',
    'gh release delete v1',
    'gh repo delete o/r --yes',
    'gh api -X DELETE repos/o/r/git/refs/heads/x',
    'gh api --method DELETE repos/o/r/git/refs/tags/v1',
    'glab mr close 1',
    'glab mr delete 1',
    'glab mr merge 1',
    'glab release delete v1',
    'glab api --method=DELETE projects/1/repository/branches/x',
  ] as (string | [string, Partial<GuardContext>])[])('refuses %s', (row) => {
    const [command, at] = Array.isArray(row) ? row : [row, {}];
    expect(denied(command, at)).not.toBeNull();
  });
});

describe('a refusal (AC-6)', () => {
  it('names the rule, the reason and an allowed alternative', () => {
    const d = checkCommand('git push --force', ctx);
    expect(d).toMatchObject({ allow: false, rule: 'git-push' });
    if (d.allow) throw new Error('allowed');
    expect(d.reason).toMatch(/force/i);
    expect(d.alternative).toMatch(/feat\/x-1/);
  });
});
