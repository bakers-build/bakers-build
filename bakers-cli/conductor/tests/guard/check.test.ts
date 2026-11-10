// The run guard's rule table: each row is a command an agent run may try and
// whether the guard lets it through (AC-1 to AC-5).
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
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
// A symlink inside the worktree that points outside it.
mkdirSync(join(root, 'outside'), { recursive: true });
symlinkSync(join(root, 'outside'), join(worktree, 'link'));

const ctx: GuardContext = {
  cwd: worktree,
  worktree,
  tmpdir: tmp,
  home,
  branch: 'feat/x-1',
  head: 'feat/x-1',
  ddevProject: 'x-1',
};

function denied(command: string, at: Partial<GuardContext> = {}) {
  const d = checkCommand(command, { ...ctx, ...at });
  return d.allow ? null : d.rule;
}

describe('git push (AC-1, AC-5)', () => {
  it.each([
    'git push -u origin HEAD',
    'git push origin feat/x-1',
    'git push origin HEAD:feat/x-1',
    'git push origin HEAD:refs/heads/feat/x-1',
    'git push --set-upstream origin feat/x-1-v2',
    'git status && git push origin feat/x-1',
    'git checkout -b feat/x-1-v2 && git push -u origin HEAD',
    'git switch feat/x-1 && git push origin HEAD',
    'git -c user.name=x commit -m y',
    'git config user.email a@b',
    'git config --get remote.origin.url',
    'git remote -v',
    'git push --dry-run -u origin HEAD',
    'git push --no-verify --porcelain origin HEAD:feat/x-1',
    'git add -A && git commit -m x && git push -u origin HEAD',
    'git fetch origin && git rebase origin/next && git push origin HEAD:feat/x-1',
    'git symbolic-ref --short HEAD && git push origin HEAD',
  ])('allows %s', (command) => {
    expect(denied(command)).toBeNull();
  });

  it.each([
    'git push',
    'git push origin',
    'git push --force',
    'git push -f origin feat/x-1',
    'git push -uf origin feat/x-1',
    'git push --force-with-lease origin feat/x-1',
    'git push --force-with-lease=feat/x-1 origin feat/x-1',
    'git push --force-if-includes origin feat/x-1',
    'git push origin +feat/x-1',
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
    'git checkout main && git push',
    'git switch main && git push origin HEAD',
    'git checkout $B && git push',
    ['git push origin HEAD', { head: 'main' }],
    ['git push -u origin HEAD', { head: undefined }],
    'gh pr checkout 2 && git push origin HEAD',
    'git push origin --delete other',
    // A run deletes no remote branch, its own included (AC-1).
    'git push origin --delete feat/x-1',
    'git push -d origin feat/x-1',
    'git push origin :feat/x-1-old',
    'git push origin :refs/heads/feat/x-1',
    'git send-pack --force ../bare.git HEAD:main',
    'git send-pack origin HEAD:feat/x-1',
    'git http-push https://example.com/r.git main',
    'git -c alias.p="push --force" p origin feat/x-1',
    'git -c remote.origin.mirror=true push origin',
    'git -c push.default=matching push',
    'git config remote.origin.mirror true && git push',
    'git config --global push.default matching',
    'git config set alias.p "push -f"',
    'git remote set-url origin https://example.com/r.git',
    "GIT_CONFIG_PARAMETERS=\"'remote.origin.mirror'='true'\" git push origin",
    // git accepts any unambiguous prefix of a long option.
    'git push --force-w origin feat/x-1',
    'git push --forc origin feat/x-1',
    'git push --del origin feat/x-1',
    'git push --tag origin HEAD',
    'git push --mir origin HEAD:feat/x-1',
    'git push --rep=other origin HEAD:feat/x-1',
    // Commands that may leave another branch checked out.
    'git checkout - && git push origin HEAD',
    'git symbolic-ref HEAD refs/heads/main && git push origin HEAD',
    'git rebase main main && git push -u origin HEAD',
    'git stash branch main && git push origin HEAD',
    // Configuration that renames push or loads other configuration.
    'git config -f .git/config alias.p "push --force"',
    'git config --file=.git/config alias.p "push --force"',
    'git config --type bool alias.p "push --force"',
    'git config include.path ../evil',
    'git config includeIf.gitdir:~/.path ../evil',
    'git -c include.path=../evil push origin HEAD',
    'git bisect start main && git push origin HEAD',
  ] as (string | [string, Partial<GuardContext>])[])('refuses %s', (row) => {
    const [command, at] = Array.isArray(row) ? row : [row, {}];
    expect(denied(command, at)).not.toBeNull();
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
    'git update-ref refs/heads/feat/x-1 HEAD~1',
    'git stash list',
    'git branch -D feat/x-1-old',
    'git branch --list',
    'git branch --contains HEAD',
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
    'git update-ref refs/heads/main HEAD',
    'git update-ref refs/tags/v1 HEAD',
    'git update-ref --stdin < cmds',
    'git -C /elsewhere reset --hard',
    'git --work-tree=/elsewhere clean -fdx',
    'git --git-dir=/elsewhere/.git reset --hard',
    'cd .. && git reset --hard',
    'git restore ../x-2/a.ts',
    'git checkout -- /etc/hosts',
    'git stash drop',
    'git stash clear',
    'git -C ~/Documents reset --har',
    'git -C ~/Documents reset $H',
    'git $SUB --force origin feat/x-1',
    'git $(echo push) --force origin feat/x-1',
    'git branch --del main',
    'git branch --move main y',
    'git branch --forc main HEAD',
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
    'rm -r link',
    '(rm -rf build)',
    'if true; then rm -rf build; fi',
    'timeout 5 rm -rf build',
    'nice -n 5 rm -rf build',
    'sudo -u root rm build/a',
    'ls build | xargs -n1 echo',
    'echo {a,b}',
    'eval "rm -rf build"',
    "rm -rf 'build/{a,b}'",
    'find build -name x -exec rm {} \\;',
    '$HOME/bin/tool --version',
    'echo ${HOME}',
    'constructor x',
    'rm -rf build/../build/a',
    '(cd build && rm -rf out)',
    'mkdir -p out && cd out && rm -rf x',
    `cd ${home} && (cd ${worktree} && rm -rf build)`,
    '(cd build) && rm -rf out',
    'bash scripts/x.sh',
    'bash -e scripts/x.sh arg',
    'bash -o pipefail -c "rm -rf build"',
    'source .venv/bin/activate',
    'echo $(git rev-parse HEAD)',
    'git commit -m "$(cat msg.txt)"',
    'echo `date`',
    'find -x build -delete',
    'find . -name x -exec grep -l y {} +',
    "find build -exec sh -c 'rm -rf build' \\;",
    'watch -n 1 ls',
    "trap 'rm -rf build' EXIT",
    'trap - EXIT',
    'setsid ls',
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
    'rm -rf link/',
    'rm -rf link/*',
    'rm link/a',
    'find link/ -delete',
    'find -L link -delete',
    '(rm -rf ~/x)',
    '{ rm -rf ~/x; }',
    'if true; then rm -rf ~/x; fi',
    'for f in a; do rm -rf ~/x; done',
    '! rm -rf ~/x',
    'sudo -u root rm -rf ~/x',
    'env -u FOO rm -rf ~/x',
    "env -S 'rm -rf /etc/x'",
    'timeout 5 rm -rf ~/x',
    'timeout -s KILL 5 rm -rf ~/x',
    'nice -n 5 rm -rf ~/x',
    'xargs -0 rm -rf < list',
    'xargs -I{} rm {} < list',
    'rm ~root/x',
    "rm $'/etc/x'",
    'eval rm -rf ~/x',
    'eval "git push --force origin feat/x-1"',
    'builtin eval rm -rf ~/x',
    'eval $CMD',
    'rm -rf {a,../x}',
    'rm -rf build/{a,../../x}',
    'find {.,..} -delete',
    'rm -rf build/{1..3}',
    'R=rm; $R -rf ~/x',
    '${R:-rm} -rf ~/x',
    '"$R" -rf ~/x',
    '$(echo rm) -rf ~/x',
    // `..` after a symlink leaves the directory the link points to.
    'rm -rf link/../x',
    'cd link/.. && rm -rf x',
    // A cd that may fail, or runs in a subshell, leaves the directory unknown.
    `cd ${home}; cd ${worktree}/nope; rm -rf x`,
    `cd ${home}/Documents && (cd ${worktree}) && rm -rf x`,
    `cd ${home} && pushd ${worktree} && popd && rm -rf x`,
    `cd ${home} && cd ${worktree}/nope || rm -rf x`,
    `cd ${home} && true | cd ${worktree} && rm -rf x`,
    `cd ${worktree}; rm -rf x`,
    // A shell reading code from stdin, a here-string or a computed string.
    'echo "rm -f ~/x" | bash',
    "bash <<< 'rm -rf ~/x'",
    'sh -c "rm -rf $X"',
    'bash -c "$(echo rm -rf ~/x)"',
    'bash -s < cmds',
    'bash $SCRIPT',
    'source <(echo rm -rf ~/x)',
    '. <(echo rm -rf ~/x)',
    "ksh -c 'rm -rf ~/x'",
    // A computed command name, and a word the shell splits.
    'CMD="rm -f ~/x"; $CMD',
    '$(echo rm -rf ~/x)',
    'rm${IFS}-rf${IFS}~/x',
    'rm -rf${IFS}~/x',
    // A command substitution runs too.
    'echo $(rm -rf ~/x)',
    'echo `rm -rf ~/x`',
    'echo "$(rm -rf ~/x)"',
    'git commit -m "$(git push --force origin feat/x-1)"',
    // `>|` is a redirect, not a pipe.
    'rm -f >| foo ~/x',
    "rm -rf {a/b/c,' '/../../x}",
    // find options before the start path, and what -exec runs.
    'find -x ~/x -delete',
    'find -- ~/x -delete',
    'find -E ~/x -delete',
    'find -O3 ~/x -delete',
    'find -f ~/x -delete',
    "find . -exec sh -c 'rm -rf ~/x' \\;",
    'find ~ -exec env rm {} +',
    'find ~ -execdir sudo rm {} \\;',
    'find -L link -exec rm {} +',
    // Commands that run other commands.
    'setsid rm -rf ~/x',
    'watch -n 1 rm -rf ~/x',
    "watch 'rm -rf ~/x'",
    'flock /tmp/l rm -rf ~/x',
    "flock -n /tmp/l -c 'rm -rf ~/x'",
    'caffeinate -i rm -rf ~/x',
    "trap 'rm -rf ~/x' EXIT",
    'ls | xargs env rm -rf',
    'xargs sudo rm < list',
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
    'ddev stop -R',
    'ddev stop -R x-1',
    'ddev stop -a',
    'ddev start',
    'ddev exec drush cr',
    'gh pr view 1',
    'gh pr create --fill',
    'glab mr create --fill',
    'gh api repos/o/r/pulls',
    'gh pr merge 1 --squash',
    'gh pr merge 1 --squash --delete-branch',
    'glab mr merge 1 --squash --remove-source-branch',
    'gh api -X PUT repos/o/r/pulls/1/merge -f merge_method=squash',
    'gh api -X PATCH repos/o/r/git/refs/heads/feat/x-1 -f sha=abc',
    'gh api repos/o/r/pulls -f base=next -f head=feat/x-1 -f title=t',
    'gh api repos/o/r/contents/x -X PUT -f branch=feat/x-1 -f message=m -f content=Yg==',
    'gh -R o/r pr view 1',
    'gh api repos/o/r/pulls/1 --jq .state',
    'gh api repos/o/r/issues -F title=x',
    'ddev stop --remove-data=true',
    'gh alias list',
    'git config -f .gitmodules submodule.x.url y',
  ])('allows %s', (command) => {
    expect(denied(command)).toBeNull();
  });

  it.each([
    'ddev delete other -y',
    'ddev delete --all -y',
    'ddev stop --remove-data other',
    'ddev stop --all --remove-data',
    ['ddev delete -Oy', { cwd: home }],
    'ddev stop -R other',
    'ddev stop -aR',
    'ddev stop -Ra',
    'ddev rm -R other',
    ['ddev stop -R', { cwd: home }],
    'gh pr close 1',
    'gh release delete v1',
    'gh repo delete o/r --yes',
    'gh api -X DELETE repos/o/r/git/refs/heads/x',
    'gh api --method DELETE repos/o/r/git/refs/tags/v1',
    'glab mr close 1',
    'glab mr delete 1',
    'glab release delete v1',
    'glab api --method=DELETE projects/1/repository/branches/x',
    'gh api -X DELETE repos/o/r/git/refs/heads/feat/x-1',
    'glab api -X DELETE projects/1/repository/branches/feat%2Fx-1',
    'gh api repos/o/r/contents/x -X PUT -f branch=main -f message=m -f content=Yg==',
    'gh api repos/o/r/merges -f base=main -f head=feat/x-1',
    'gh api -X POST repos/o/r/branches/main/rename -f new_name=old',
    'gh -R o/r pr close 1',
    'gh pr --repo o/r close 1',
    'glab -R o/r mr close 1',
    'gh api -X PATCH repos/o/r/git/refs/heads/main -f sha=abc -F force=true',
    'gh api repos/o/r/git/refs/heads/main -X PATCH -f sha=abc',
    'gh api -X PATCH repos/o/r/git/refs/tags/v1 -f sha=abc',
    'gh api repos/o/r/pulls/1 -X PATCH -f state=closed',
    'gh api -X PUT projects/1/merge_requests/2 -f state_event=close',
    'gh api graphql -f query=\'mutation { closePullRequest(input: {pullRequestId: "x"}) { clientMutationId } }\'',
    'gh api graphql -f query=\'mutation { deleteRef(input: {refId: "x"}) { clientMutationId } }\'',
    'gh api -X PATCH repos/o/r/pulls/1 --input body.json',
    'ddev stop --remove-data=true other',
    'ddev delete --all=true -y',
    // A field read from a file is a body the guard cannot see.
    'gh api -X PATCH repos/o/r/pulls/1 -F state=@s.txt',
    'gh api graphql -F query=@q.graphql',
    'gh api -X PATCH repos/o/r/pulls/1 --field=state=@s.txt',
    'gh api -X PATCH repos/o/r/pulls/1 --input=body.json',
    "gh alias set c 'pr close'",
    "glab alias set c 'mr close'",
    'gh api graphql -f query=\'mutation { updateRef(input: {refId: "x", oid: "y", force: true}) { clientMutationId } }\'',
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
