// The run guard (docs/provision/security/execution.md › Run guard): one pure
// decision per shell command an agent run is about to execute. It matches
// commands, so a command hidden in a script or interpreter is not inspected.
import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

export interface GuardContext {
  /** Where the command starts. */
  cwd: string;
  /** The run's own worktree. */
  worktree: string;
  tmpdir: string;
  home: string;
  /** The ticket's `branch_name`; a run owns it and `<branch>-<suffix>`. */
  branch: string;
  /** The branch checked out in the worktree when the command starts; unknown when absent. */
  head?: string;
  /** The `name` in the worktree's `.ddev/config.yaml`, if any. */
  ddevProject?: string;
}

export type GuardDecision =
  | { allow: true }
  | { allow: false; rule: string; reason: string; alternative: string };

interface Word {
  text: string;
  /** Holds `$(…)`, a backtick or a variable the guard cannot expand. */
  dynamic: boolean;
  glob: boolean;
  op?: 'redirect';
}

const ALLOW: GuardDecision = { allow: true };
/** Stands in for `$PWD`, which the segment's tracked cwd replaces. */
const PWD = '\0PWD\0';
const DELETERS = new Set(['rm', 'rmdir', 'unlink', 'shred']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash']);
/** Command wrappers: the options that take a value, and the positionals before the command. */
const WRAPPERS: Record<string, { values: string[]; positionals?: number }> = {
  sudo: {
    values: ['-u', '-g', '-C', '-h', '-p', '-U', '-D', '-r', '-t', '-T'],
  },
  doas: { values: ['-u', '-C'] },
  env: { values: ['-u', '--unset', '-C', '--chdir'] },
  command: { values: [] },
  builtin: { values: [] },
  exec: { values: ['-a'] },
  nohup: { values: [] },
  time: { values: ['-f', '-o'] },
  nice: { values: ['-n', '--adjustment'] },
  ionice: { values: ['-c', '-n', '-p'] },
  stdbuf: { values: ['-i', '-o', '-e'] },
  timeout: { values: ['-s', '--signal', '-k', '--kill-after'], positionals: 1 },
};
/** Shell grammar words before a simple command. */
const GRAMMAR = new Set([
  '!',
  '{',
  '}',
  'if',
  'then',
  'elif',
  'else',
  'while',
  'until',
  'do',
]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
/** Environment that points git at another repository or configuration. */
const GIT_ENV = /^GIT_(CONFIG|DIR|WORK_TREE|COMMON_DIR|NAMESPACE)/;
/** Config keys that change what `git push` sends or where. */
const PUSH_KEYS = /^(alias|remote|push|url)\./i;

/** Split a command into segments of words, one per simple command. */
function tokenize(command: string, ctx: GuardContext): Word[][] {
  const segments: Word[][] = [];
  let words: Word[] = [];
  let word: Word | null = null;
  const cur = () => {
    word ??= { text: '', dynamic: false, glob: false };
    return word;
  };
  const endWord = () => {
    if (word) words.push(word);
    word = null;
  };
  const endSegment = () => {
    endWord();
    if (words.length) segments.push(words);
    words = [];
  };
  const vars: Record<string, string> = {
    HOME: ctx.home,
    TMPDIR: ctx.tmpdir,
    PWD,
  };
  let i = 0;
  // Reads `$…` at i; returns the expansion or null for an unknown one.
  const dollar = (): string | null => {
    const next = command[i + 1];
    if (next === "'") {
      // `$'…'` decodes escapes the guard does not follow.
      i++;
      return null;
    }
    if (next === '(') {
      let depth = 0;
      for (i += 1; i < command.length; i++) {
        if (command[i] === '(') depth++;
        else if (command[i] === ')' && --depth === 0) break;
      }
      i++;
      return null;
    }
    const m =
      /^\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*)|([?$#!@*0-9-]))/.exec(
        command.slice(i),
      );
    if (!m) {
      if (next === '{') {
        // `${R:-rm}` and other parameter operators: a value the guard does not compute.
        const end = command.indexOf('}', i);
        i = end === -1 ? command.length : end + 1;
        return null;
      }
      i++;
      return '$';
    }
    i += m[0].length;
    const name = m[1] ?? m[2];
    return name !== undefined && name in vars ? (vars[name] as string) : null;
  };
  const backtick = () => {
    const end = command.indexOf('`', i + 1);
    i = end === -1 ? command.length : end + 1;
  };
  while (i < command.length) {
    const c = command[i] as string;
    if (c === ' ' || c === '\t') {
      endWord();
      i++;
    } else if (c === '\n' || c === ';' || c === '(' || c === ')') {
      endSegment();
      i++;
    } else if (c === '&' || c === '|') {
      if (c === '&' && command[i + 1] === '>') {
        endWord();
        words.push({ text: '&>', dynamic: false, glob: false, op: 'redirect' });
        i += command[i + 2] === '>' ? 3 : 2;
      } else {
        endSegment();
        i += command[i + 1] === c ? 2 : 1;
      }
    } else if (c === '>' || c === '<') {
      // A file descriptor number before the operator belongs to it.
      if (word && /^\d+$/.test((word as Word).text)) word = null;
      endWord();
      words.push({ text: c, dynamic: false, glob: false, op: 'redirect' });
      i++;
      while (command[i] === '>' || command[i] === '&') i++;
    } else if (c === "'") {
      const end = command.indexOf("'", i + 1);
      cur().text += command.slice(i + 1, end === -1 ? undefined : end);
      i = end === -1 ? command.length : end + 1;
    } else if (c === '"') {
      const w = cur();
      for (i++; i < command.length && command[i] !== '"'; ) {
        const d = command[i] as string;
        if (d === '\\' && '"\\$`'.includes(command[i + 1] ?? '')) {
          w.text += command[i + 1];
          i += 2;
        } else if (d === '$') {
          const v = dollar();
          if (v === null) w.dynamic = true;
          else w.text += v;
        } else if (d === '`') {
          w.dynamic = true;
          backtick();
        } else {
          w.text += d;
          i++;
        }
      }
      i++;
    } else if (c === '\\') {
      if (command[i + 1] !== '\n') cur().text += command[i + 1] ?? '';
      i += 2;
    } else if (c === '$') {
      const w = cur();
      const v = dollar();
      if (v === null) w.dynamic = true;
      else w.text += v;
    } else if (c === '`') {
      cur().dynamic = true;
      backtick();
    } else if (c === '~' && !word) {
      // `~user`, `~+` and `~-` are directories the guard does not know.
      if (
        i + 1 === command.length ||
        ' \t\n;&|/'.includes(command[i + 1] as string)
      )
        cur().text += ctx.home;
      else cur().dynamic = true;
      i++;
    } else {
      const w = cur();
      if ('*?['.includes(c)) w.glob = true;
      // Brace expansion (`{a,../x}`, `{1..3}`) yields words the guard does not expand.
      if (c === '{' && /^\{[^\s{}]*(,|\.\.)[^\s{}]*\}/.test(command.slice(i)))
        w.dynamic = true;
      w.text += c;
      i++;
    }
  }
  endSegment();
  return segments;
}

/** The real path of `p`'s parent (a symlink itself is what `rm` removes). */
function canonical(p: string): string {
  let dir = dirname(p);
  const rest = [basename(p)];
  while (!existsSync(dir) && dirname(dir) !== dir) {
    rest.unshift(basename(dir));
    dir = dirname(dir);
  }
  try {
    return join(realpathSync(dir), ...rest);
  } catch {
    return p;
  }
}

/** The real path of `p` itself, through a final symlink. */
function followed(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return canonical(p);
  }
}

function realDir(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

const inside = (p: string, dir: string) =>
  p === dir || p.startsWith(dir.endsWith('/') ? dir : `${dir}/`);

const deny = (
  rule: string,
  reason: string,
  alternative: string,
): GuardDecision => ({ allow: false, rule, reason, alternative });

const unresolvable = (what: string) =>
  deny(
    'unresolvable',
    `the guard cannot resolve ${what}`,
    'write the target as a literal path inside the worktree or $TMPDIR',
  );

class Checker {
  /** The checked-out branch as the command goes on; null when unknown. */
  private head: string | null;
  /** A segment so far set git's repository or configuration through the environment. */
  private gitEnv = false;

  constructor(private readonly ctx: GuardContext) {
    this.head = ctx.head ?? null;
  }

  /**
   * A word as an absolute path, or null when it depends on the shell. With
   * `follow`, a trailing `/` or a glob, a final symlink is resolved too.
   */
  path(word: Word, cwd: string | null, follow = false): string | null {
    if (word.dynamic) return null;
    let text = word.text;
    const through = follow || word.glob || /\/\.?$/.test(text);
    if (text.includes(PWD)) {
      if (cwd === null) return null;
      text = text.replaceAll(PWD, cwd);
    }
    if (word.glob) {
      // The directory the pattern expands in.
      const at = text.search(/[*?[]/);
      text = text.slice(0, text.lastIndexOf('/', at) + 1) || '.';
    }
    if (!isAbsolute(text)) {
      if (cwd === null) return null;
      text = resolve(cwd, text);
    }
    return through ? followed(resolve(text)) : canonical(resolve(text));
  }

  deletable(p: string): boolean {
    return inside(p, this.ctx.worktree) || inside(p, this.ctx.tmpdir);
  }

  owned(ref: string): boolean {
    const name = ref.replace(/^refs\/heads\//, '');
    const { branch } = this.ctx;
    return name === branch || name.startsWith(`${branch}-`);
  }

  run(command: string, cwd: string | null): GuardDecision {
    for (const segment of tokenize(command, this.ctx)) {
      const words = segment.filter((w, i) => !w.op && !segment[i - 1]?.op);
      const assigned: Word[] = [];
      // Strip grammar words, assignments and wrappers down to the command.
      for (let changed = true; changed && words[0]; ) {
        changed = false;
        const first = words[0] as Word;
        if (GRAMMAR.has(first.text) || first.text === 'time') {
          words.shift();
          changed = true;
        } else if (ASSIGNMENT.test(first.text)) {
          assigned.push(first);
          words.shift();
          changed = true;
        } else if (Object.hasOwn(WRAPPERS, basename(first.text))) {
          const spec = WRAPPERS[basename(first.text)] as {
            values: string[];
            positionals?: number;
          };
          words.shift();
          let positionals = spec.positionals ?? 0;
          while (words[0]) {
            const t = words[0].text;
            if (t === '-S' || t === '--split-string') {
              // `env -S 'cmd …'` runs the string as a command line.
              const rest = words.slice(1);
              if (rest.some((w) => w.dynamic))
                return unresolvable('the command env -S runs');
              const d = this.run(rest.map((w) => w.text).join(' '), cwd);
              if (!d.allow) return d;
              words.length = 0;
              break;
            }
            if (spec.values.includes(t)) words.splice(0, 2);
            else if (t.startsWith('-') || ASSIGNMENT.test(t)) {
              if (ASSIGNMENT.test(t)) assigned.push(words[0]);
              words.shift();
            } else if (positionals > 0) {
              positionals--;
              words.shift();
            } else break;
          }
          changed = true;
        }
      }
      const verb = words[0];
      const setsGit = (w: Word) => GIT_ENV.test(w.text);
      // An assignment alone or an export holds for the rest of the command.
      const sticky = verb
        ? ['export', 'declare', 'typeset'].includes(verb.text) &&
          words.slice(1).some(setsGit)
        : assigned.some(setsGit);
      if (sticky) this.gitEnv = true;
      if (!verb) continue;
      // A computed command name could be any verb, a destructive one included.
      if (verb.dynamic && words.length > 1)
        return unresolvable('the command a computed name runs');
      const name = basename(verb.text);
      const args = words.slice(1);
      const gitEnv = this.gitEnv;
      if (assigned.some(setsGit)) this.gitEnv = true;
      if (name === 'cd' || name === 'pushd') {
        const target = args.find((w) => !w.text.startsWith('-'));
        cwd = target
          ? this.path({ ...target, glob: false }, cwd)
          : this.ctx.home;
        continue;
      }
      const d = this.simple(name, args, cwd);
      this.gitEnv = gitEnv;
      if (!d.allow) return d;
    }
    return ALLOW;
  }

  simple(name: string, args: Word[], cwd: string | null): GuardDecision {
    if (SHELLS.has(name)) {
      const flag = args.findIndex((w) => /^-[a-z]*c[a-z]*$/.test(w.text));
      const script = flag === -1 ? undefined : args[flag + 1];
      // A script the guard cannot read is out of its reach, like a file.
      return script && !script.dynamic ? this.run(script.text, cwd) : ALLOW;
    }
    if (name === 'eval') {
      if (args.some((w) => w.dynamic))
        return unresolvable('the command eval runs');
      return this.run(args.map((w) => w.text).join(' '), cwd);
    }
    if (DELETERS.has(name)) return this.deleting(name, args, cwd);
    if (name === 'find') return this.find(args, cwd);
    if (name === 'xargs') return this.xargs(args, cwd);
    if (name === 'git') return this.git(args, cwd);
    if (name === 'ddev') return this.ddev(args, cwd);
    if (name === 'gh' || name === 'glab') return this.forge(name, args);
    return ALLOW;
  }

  /** The command xargs runs, with arguments the guard cannot know. */
  xargs(args: Word[], cwd: string | null): GuardDecision {
    const values = ['-I', '-n', '-P', '-L', '-d', '-E', '-s', '-a'];
    let i = 0;
    while (i < args.length && (args[i] as Word).text.startsWith('-'))
      i += values.includes((args[i] as Word).text) ? 2 : 1;
    const verb = args[i];
    if (!verb) return ALLOW;
    const unknown: Word = { text: '', dynamic: true, glob: false };
    return this.simple(
      basename(verb.text),
      [...args.slice(i + 1), unknown],
      cwd,
    );
  }

  targets(
    name: string,
    paths: Word[],
    cwd: string | null,
    follow = false,
  ): GuardDecision {
    for (const w of paths) {
      const p = this.path(w, cwd, follow);
      if (p === null) return unresolvable(`the target of ${name} ${w.text}`);
      if (!this.deletable(p))
        return deny(
          'delete-outside',
          `${name} would delete ${p}, outside the run's worktree and $TMPDIR`,
          `delete only inside ${this.ctx.worktree} or $TMPDIR`,
        );
    }
    return ALLOW;
  }

  deleting(name: string, args: Word[], cwd: string | null): GuardDecision {
    const end = args.findIndex((w) => w.text === '--');
    const paths = [
      ...(end === -1 ? args : args.slice(0, end)).filter(
        (w) => !w.text.startsWith('-'),
      ),
      ...(end === -1 ? [] : args.slice(end + 1)),
    ];
    return this.targets(name, paths, cwd);
  }

  find(args: Word[], cwd: string | null): GuardDecision {
    const destructive = args.some(
      (w, i) =>
        w.text === '-delete' ||
        (['-exec', '-execdir', '-ok', '-okdir'].includes(w.text) &&
          DELETERS.has(basename(args[i + 1]?.text ?? ''))),
    );
    if (!destructive) return ALLOW;
    const follow = args.some((w) => w.text === '-L' || w.text === '-H');
    const rest = args.filter((w) => !['-H', '-L', '-P'].includes(w.text));
    const end = rest.findIndex((w) => /^[-(!]/.test(w.text));
    const starts = rest.slice(0, end === -1 ? undefined : end);
    return this.targets(
      'find',
      starts.length ? starts : [{ text: '.', dynamic: false, glob: false }],
      cwd,
      follow,
    );
  }

  git(args: Word[], cwd: string | null): GuardDecision {
    let dir = cwd;
    let workTree: string | null | undefined;
    let gitDir = false;
    let i = 0;
    for (; i < args.length; i++) {
      const t = (args[i] as Word).text;
      if (t === '-C') {
        const w = args[++i];
        dir = w ? this.path({ ...w, glob: false }, dir) : null;
      } else if (t === '-c' || t.startsWith('--config-env')) {
        const w = t === '-c' || t === '--config-env' ? args[++i] : args[i];
        const key = (w?.text ?? '').replace(/^--config-env=/, '');
        if (!w || w.dynamic || PUSH_KEYS.test(key))
          return deny(
            'git-config',
            `git ${t} ${w?.text ?? ''} could change what git push sends or where`,
            'run git without -c for alias, remote, push or url keys',
          );
      } else if (t === '--work-tree' || t.startsWith('--work-tree=')) {
        const w =
          t === '--work-tree'
            ? args[++i]
            : { ...(args[i] as Word), text: t.slice(12) };
        workTree = w ? this.path({ ...w, glob: false }, dir) : null;
      } else if (t === '--git-dir' || t.startsWith('--git-dir=')) {
        if (t === '--git-dir') i++;
        gitDir = true;
      } else if (!t.startsWith('-')) break;
    }
    const sub = args[i]?.text;
    const rest = args.slice(i + 1);
    const flags = rest.map((w) => w.text);
    const own = this.ctx.branch;
    // The tree a destructive subcommand acts on.
    const tree =
      workTree !== undefined ? workTree : gitDir || this.gitEnv ? null : dir;
    const inTree = () => {
      if (tree === null) return unresolvable('the repository git acts on');
      return inside(realDir(tree), this.ctx.worktree)
        ? ALLOW
        : deny(
            'git-discard-outside',
            `git ${sub} would act on ${tree}, outside the run's worktree`,
            `run git ${sub} only inside ${this.ctx.worktree}`,
          );
    };
    const positional = rest.filter((w) => !w.text.startsWith('-'));
    const named = (opts: string[]) => {
      const at = rest.findIndex((w) => opts.includes(w.text));
      return at === -1 ? undefined : rest[at + 1];
    };
    switch (sub) {
      case 'push':
        return this.push(rest, tree);
      case 'send-pack':
      case 'http-push':
        return deny(
          'git-push',
          `git ${sub} updates remote refs past the push rules`,
          `push only this run's branch without force: git push -u origin HEAD (on ${own})`,
        );
      case 'config':
        return this.config(rest);
      case 'remote':
        return ['set-url', 'rename'].includes(positional[0]?.text ?? '')
          ? deny(
              'git-config',
              `git remote ${positional[0]?.text} would change where git push sends`,
              'push to origin as it is configured',
            )
          : ALLOW;
      case 'switch': {
        const to =
          named(['-c', '-C', '--create', '--force-create']) ??
          (flags.includes('-d') || flags.includes('--detach')
            ? undefined
            : positional[0]);
        this.head = to && !to.dynamic ? to.text : null;
        return ALLOW;
      }
      case 'branch': {
        const destructive = flags.some(
          (f) =>
            f === '--delete' ||
            f === '--force' ||
            /^-[a-zA-Z]*[dDfMC]/.test(f) ||
            f === '-m',
        );
        const other = positional.find((w) => w.dynamic || !this.owned(w.text));
        return destructive && other
          ? deny(
              'git-branch-delete',
              `git branch would delete or rewrite ${other.text}, which this run does not own`,
              `delete or move only ${own}`,
            )
          : ALLOW;
      }
      case 'worktree': {
        if (positional[0]?.text !== 'remove') return ALLOW;
        const target = positional[1];
        const p = target && this.path({ ...target, glob: false }, dir);
        return p && realDir(p) === this.ctx.worktree
          ? ALLOW
          : deny(
              'git-worktree-remove',
              `git worktree remove would remove ${target?.text ?? 'a worktree'}, not this run's`,
              'leave other worktrees to their own runs',
            );
      }
      case 'update-ref': {
        if (flags.includes('--stdin'))
          return unresolvable('the refs git update-ref --stdin changes');
        const ref = positional[0];
        if (!flags.includes('-d')) {
          const mine =
            ref &&
            !ref.dynamic &&
            (ref.text === 'HEAD'
              ? this.head !== null && this.owned(this.head)
              : ref.text.startsWith('refs/heads/') && this.owned(ref.text));
          return mine
            ? ALLOW
            : deny(
                'git-update-ref',
                `git update-ref would move ${ref?.text ?? 'a ref'}, which this run does not own`,
                `move only refs/heads/${own}`,
              );
        }
        return ref &&
          !ref.dynamic &&
          this.ctx.branch &&
          ref.text.replace(/^refs\/heads\//, '') === own
          ? ALLOW
          : deny(
              'git-update-ref',
              `git update-ref -d would delete ${ref?.text ?? 'a ref'}, which this run does not own`,
              `delete only refs/heads/${own}`,
            );
      }
      case 'reset':
        return flags.includes('--hard') ? inTree() : ALLOW;
      case 'clean':
        return inTree();
      case 'checkout':
      case 'restore': {
        const end = rest.findIndex((w) => w.text === '--');
        if (sub === 'checkout' && end === -1) {
          // A branch switch, or a path the guard reads as one: unknown either way.
          const to = named(['-b', '-B', '--orphan']) ?? positional[0];
          if (to) this.head = to.dynamic ? null : to.text;
        }
        if (sub === 'checkout' && end === -1 && !flags.includes('-f'))
          return ALLOW;
        const d = inTree();
        if (!d.allow) return d;
        const paths =
          end === -1
            ? positional.filter((w) => sub === 'restore' || w.text !== '.')
            : rest.slice(end + 1);
        for (const w of paths) {
          const p = this.path(w, tree);
          if (p === null) return unresolvable(`the path ${w.text}`);
          if (!inside(p, this.ctx.worktree))
            return deny(
              'git-discard-outside',
              `git ${sub} would discard changes at ${p}, outside the run's worktree`,
              `restore only paths inside ${this.ctx.worktree}`,
            );
        }
        return ALLOW;
      }
      case 'stash':
        return ['drop', 'clear'].includes(positional[0]?.text ?? '')
          ? deny(
              'git-stash',
              `git stash ${positional[0]?.text} discards entries of a stash stack shared with every worktree`,
              'set work aside in a commit on the run branch instead',
            )
          : ALLOW;
      default:
        return ALLOW;
    }
  }

  config(args: Word[]): GuardDecision {
    const flags = args.map((w) => w.text);
    const positional = args.filter((w) => !w.text.startsWith('-'));
    const reads = ['--get', '--get-all', '--get-regexp', '--get-urlmatch'];
    const sub = [
      'get',
      'list',
      'set',
      'unset',
      'rename-section',
      'remove-section',
      'edit',
    ].includes(positional[0]?.text ?? '')
      ? positional.shift()?.text
      : undefined;
    if (
      sub === 'get' ||
      sub === 'list' ||
      flags.some((f) => reads.includes(f) || f === '--list' || f === '-l')
    )
      return ALLOW;
    const edits =
      sub === 'edit' || flags.includes('--edit') || flags.includes('-e');
    const writes =
      edits ||
      sub !== undefined ||
      positional.length > 1 ||
      flags.some((f) =>
        /^--(unset|add|replace-all|rename-section|remove-section)/.test(f),
      );
    if (!writes) return ALLOW;
    const key = positional[0];
    return edits || !key || key.dynamic || PUSH_KEYS.test(key.text)
      ? deny(
          'git-config',
          `git config would change ${key?.text ?? 'the configuration'}, which decides what git push sends or where`,
          'leave alias, remote, push and url settings as they are',
        )
      : ALLOW;
  }

  push(args: Word[], tree: string | null): GuardDecision {
    const own = this.ctx.branch;
    const refuse = (reason: string) =>
      deny(
        'git-push',
        reason,
        `push only this run's branch without force: git push -u origin HEAD (on ${own}) or git push origin HEAD:${own} (or a new ${own}-<suffix> branch)`,
      );
    if (tree === null) return unresolvable('the repository git push runs in');
    if (!inside(realDir(tree), this.ctx.worktree))
      return refuse(
        `git push would run in ${tree}, outside the run's worktree`,
      );
    const positional: Word[] = [];
    let deleting = false;
    for (let i = 0; i < args.length; i++) {
      const w = args[i] as Word;
      const t = w.text;
      if (t.startsWith('--')) {
        if (/^--(force|force-with-lease|force-if-includes)(=|$)/.test(t))
          return refuse(`git push ${t} would force-push`);
        if (t === '--delete') deleting = true;
        else if (
          ['--mirror', '--all', '--branches', '--tags', '--prune'].includes(t)
        )
          return refuse(
            `git push ${t} would change or delete remote refs beyond this run's branch`,
          );
        if (t === '--repo' || t.startsWith('--repo=')) {
          return refuse(
            'git push --repo pushes to a remote the guard does not check',
          );
        }
        if (t === '--push-option' || t === '--receive-pack' || t === '--exec')
          i++;
      } else if (t.startsWith('-') && t.length > 1) {
        if (t.slice(1).includes('f'))
          return refuse(`git push ${t} would force-push`);
        if (t.slice(1).includes('d')) deleting = true;
        if (t === '-o') i++;
      } else positional.push(w);
    }
    const [remote, ...refspecs] = positional;
    if (remote && (remote.dynamic || remote.text !== 'origin'))
      return refuse(
        `git push to ${remote.text || 'a computed remote'}; only origin is allowed`,
      );
    // Without a refspec, push.default and remote.*.push from the user's config decide.
    if (refspecs.length === 0)
      return refuse(
        'git push without a refspec pushes what the git configuration says, which the guard does not read',
      );
    for (const spec of refspecs) {
      if (spec.dynamic) return unresolvable('the refspec git push sends');
      const t = spec.text;
      if (t.startsWith('+')) return refuse(`git push ${t} would force-push`);
      const dst = t.slice(t.lastIndexOf(':') + 1);
      // A run deletes no remote branch or tag, its own included.
      if (deleting || t.startsWith(':'))
        return refuse(`git push would delete ${dst} on the remote`);
      if (dst === 'HEAD' || (!t.includes(':') && t === 'HEAD')) {
        if (this.head === null)
          return unresolvable('the branch HEAD points at');
        if (!this.owned(this.head))
          return refuse(
            `git push HEAD would update ${this.head}, which this run does not own`,
          );
      } else if (!this.owned(dst))
        return refuse(
          `git push would update ${dst}, which this run does not own`,
        );
    }
    return ALLOW;
  }

  ddev(args: Word[], cwd: string | null): GuardDecision {
    const sub = args.find((w) => !w.text.startsWith('-'));
    const flags = args.map((w) => w.text);
    // Short options bundle (`-aR`): `-R` is --remove-data, `-a` is --all.
    const short = (c: string) =>
      flags.some((f) => new RegExp(`^-[a-zA-Z]*${c}`).test(f));
    if (
      sub?.text !== 'delete' &&
      !flags.includes('--remove-data') &&
      !short('R')
    )
      return ALLOW;
    const refuse = (what: string) =>
      deny(
        'ddev-other',
        `ddev ${sub?.text} would remove ${what}`,
        `remove data only of this run's own project${this.ctx.ddevProject ? ` (${this.ctx.ddevProject})` : ''}, from its worktree`,
      );
    if (flags.includes('--all') || short('a'))
      return refuse('every DDEV project');
    const projects = args.filter((w) => w !== sub && !w.text.startsWith('-'));
    for (const p of projects)
      if (p.dynamic || p.text !== this.ctx.ddevProject)
        return refuse(`the DDEV project ${p.text}`);
    if (projects.length) return ALLOW;
    if (cwd === null) return unresolvable('the DDEV project ddev acts on');
    return inside(realDir(cwd), this.ctx.worktree)
      ? ALLOW
      : refuse(`the DDEV project at ${cwd}`);
  }

  forge(name: string, args: Word[]): GuardDecision {
    // Options whose value would otherwise read as the group, action or endpoint.
    const values = new Set([
      '-R',
      '--repo',
      '-X',
      '--method',
      '-f',
      '-F',
      '--field',
      '--raw-field',
      '-H',
      '--header',
      '-q',
      '--jq',
      '-t',
      '--template',
      '--input',
      '--hostname',
      '-p',
      '--preview',
    ]);
    const words: string[] = [];
    let method: string | undefined;
    let fields = false;
    for (let i = 0; i < args.length; i++) {
      const t = (args[i] as Word).text;
      const value = args[i + 1]?.text ?? '';
      if (t === '-X' || t === '--method') method = value;
      else if (t.startsWith('--method=')) method = t.slice(9);
      else if (/^-X./.test(t)) method = t.slice(2);
      if (/^(-f|-F|--field|--raw-field|--input)(=|$)/.test(t)) fields = true;
      if (values.has(t)) i++;
      else if (!t.startsWith('-')) words.push(t);
    }
    const [group, action] = words;
    const refuse = (what: string) =>
      deny(
        'forge-delete',
        `${name} ${what} would close or delete remote work`,
        'leave closing and deleting to a human; merging the pull or merge request stays allowed',
      );
    const closes: Record<string, string[]> = {
      pr: ['close', 'delete'],
      mr: ['close', 'delete'],
      release: ['delete', 'delete-asset'],
      repo: ['delete', 'archive'],
      label: ['delete'],
    };
    if ((group === 'pr' || group === 'mr') && action === 'checkout')
      this.head = null;
    if (group && action && closes[group]?.includes(action))
      return refuse(`${group} ${action}`);
    if (group !== 'api') return ALLOW;
    // gh and glab send a request with fields as a POST.
    const verb = (method ?? (fields ? 'POST' : 'GET')).toUpperCase();
    if (verb === 'GET') return ALLOW;
    const texts = args.map((w) => w.text);
    if (texts.includes('--input') || args.some((w) => w.dynamic))
      return unresolvable(`the body ${name} api sends`);
    if (action === 'graphql')
      return texts.some((t) =>
        /\b(close[A-Z]\w*|delete[A-Z]\w*|\w+(Delete|Destroy)|CLOSED?)\b/.test(
          t,
        ),
      )
        ? refuse('api graphql mutation')
        : ALLOW;
    if (texts.some((t) => /(^|=)state(_event)?=clos/.test(t)))
      return refuse(`api -X ${verb} closing a pull or merge request`);
    // A write that commits to, merges into or renames a branch names it in a field or the path.
    const field = (key: string) =>
      texts.find((t) => t.startsWith(`${key}=`))?.slice(key.length + 1);
    const written = [
      field('branch'),
      /\/merges$/.test(action ?? '') ? field('base') : undefined,
      /\/branches\/([^/]+)\//.exec(action ?? '')?.[1],
    ].find((b) => b !== undefined && !this.owned(decodeURIComponent(b)));
    if (written !== undefined)
      return deny(
        'forge-branch',
        `${name} api -X ${verb} would change ${written}, which this run does not own`,
        "write only to this run's branch; open a pull or merge request for the rest",
      );
    const ref =
      /\/git\/refs\/(heads|tags)\/(.+)$/.exec(action ?? '') ??
      /\/repository\/(branches|tags)\/(.+)$/.exec(action ?? '');
    if (ref) {
      const branch = ref[1] === 'heads' || ref[1] === 'branches';
      if (!branch || !this.owned(decodeURIComponent(ref[2] as string)))
        return refuse(
          `api -X ${verb} on ${ref[2]}, which this run does not own`,
        );
      return verb === 'DELETE'
        ? refuse(`api -X DELETE on ${ref[2]}: a run deletes no remote branch`)
        : ALLOW;
    }
    return verb === 'DELETE' ? refuse(`api -X ${verb}`) : ALLOW;
  }
}

/** Allow `command`, or deny it with the rule that matched and an alternative. */
export function checkCommand(
  command: string,
  ctx: GuardContext,
): GuardDecision {
  const real = {
    ...ctx,
    worktree: realDir(ctx.worktree),
    tmpdir: realDir(ctx.tmpdir),
  };
  return new Checker(real).run(command, realDir(ctx.cwd));
}

/** Verbs whose refusal the hook keeps when the guard itself fails. */
export const DESTRUCTIVE_VERBS = [
  ...DELETERS,
  'find',
  'xargs',
  'git',
  'ddev',
  'gh',
  'glab',
];
