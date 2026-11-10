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
const WRAPPERS = new Set(['sudo', 'env', 'command', 'nohup', 'time', 'exec']);

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
    } else if (c === '\n' || c === ';') {
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
    } else if (
      c === '~' &&
      !word &&
      (i + 1 === command.length ||
        ' \t\n;&|/'.includes(command[i + 1] as string))
    ) {
      cur().text += ctx.home;
      i++;
    } else {
      const w = cur();
      if ('*?['.includes(c)) w.glob = true;
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
  constructor(private readonly ctx: GuardContext) {}

  /** A word as an absolute path, or null when it depends on the shell. */
  path(word: Word, cwd: string | null): string | null {
    if (word.dynamic) return null;
    let text = word.text;
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
    return canonical(resolve(text));
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
      while (words[0] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0].text))
        words.shift();
      while (words[0] && WRAPPERS.has(words[0].text)) {
        words.shift();
        while (
          words[0] &&
          (words[0].text.startsWith('-') ||
            /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0].text))
        )
          words.shift();
      }
      const verb = words[0];
      if (!verb) continue;
      const name = basename(verb.text);
      const args = words.slice(1);
      if (name === 'cd' || name === 'pushd') {
        const target = args.find((w) => !w.text.startsWith('-'));
        cwd = target
          ? this.path({ ...target, glob: false }, cwd)
          : this.ctx.home;
        continue;
      }
      const d = this.simple(name, args, cwd);
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
    if (DELETERS.has(name)) return this.deleting(name, args, cwd);
    if (name === 'find') return this.find(args, cwd);
    if (name === 'xargs')
      return args.some((w) => DELETERS.has(basename(w.text)))
        ? unresolvable('the targets xargs passes to a delete')
        : ALLOW;
    if (name === 'git') return this.git(args, cwd);
    if (name === 'ddev') return this.ddev(args, cwd);
    if (name === 'gh' || name === 'glab') return this.forge(name, args);
    return ALLOW;
  }

  targets(name: string, paths: Word[], cwd: string | null): GuardDecision {
    for (const w of paths) {
      const p = this.path(w, cwd);
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
    const rest = args.filter((w) => !['-H', '-L', '-P'].includes(w.text));
    const end = rest.findIndex((w) => /^[-(!]/.test(w.text));
    const starts = rest.slice(0, end === -1 ? undefined : end);
    return this.targets(
      'find',
      starts.length ? starts : [{ text: '.', dynamic: false, glob: false }],
      cwd,
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
      } else if (t === '-c') i++;
      else if (t === '--work-tree' || t.startsWith('--work-tree=')) {
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
    const tree = workTree !== undefined ? workTree : gitDir ? null : dir;
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
    switch (sub) {
      case 'push':
        return this.push(rest, tree);
      case 'branch': {
        const destructive = flags.some(
          (f) =>
            f === '--delete' ||
            f === '--force' ||
            /^-[a-zA-Z]*[dDfMC]/.test(f) ||
            f === '-m',
        );
        const other = positional.find((w) => w.dynamic || w.text !== own);
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
        if (!flags.includes('-d')) return ALLOW;
        const ref = positional[0];
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

  push(args: Word[], tree: string | null): GuardDecision {
    const own = this.ctx.branch;
    const refuse = (reason: string) =>
      deny(
        'git-push',
        reason,
        `push only this run's branch without force: git push origin HEAD:${own} (or a new ${own}-<suffix> branch)`,
      );
    if (tree === null) return unresolvable('the repository git push runs in');
    if (!inside(realDir(tree), this.ctx.worktree))
      return refuse(
        `git push would run in ${tree}, outside the run's worktree`,
      );
    const positional: Word[] = [];
    for (let i = 0; i < args.length; i++) {
      const w = args[i] as Word;
      const t = w.text;
      if (t.startsWith('--')) {
        if (/^--(force|force-with-lease|force-if-includes)(=|$)/.test(t))
          return refuse(`git push ${t} would force-push`);
        if (
          [
            '--delete',
            '--mirror',
            '--all',
            '--branches',
            '--tags',
            '--prune',
          ].includes(t)
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
        if (/[fd]/.test(t.slice(1)))
          return refuse(
            `git push ${t} would force-push or delete a remote ref`,
          );
        if (t === '-o') i++;
      } else positional.push(w);
    }
    const [remote, ...refspecs] = positional;
    if (remote && (remote.dynamic || remote.text !== 'origin'))
      return refuse(
        `git push to ${remote.text || 'a computed remote'}; only origin is allowed`,
      );
    for (const spec of refspecs) {
      if (spec.dynamic) return unresolvable('the refspec git push sends');
      const t = spec.text;
      if (t.startsWith('+')) return refuse(`git push ${t} would force-push`);
      if (t.startsWith(':'))
        return refuse(`git push ${t} would delete a remote ref`);
      const dst = t.slice(t.lastIndexOf(':') + 1);
      if (!((dst === 'HEAD' && !t.includes(':')) || this.owned(dst)))
        return refuse(
          `git push would update ${dst}, which this run does not own`,
        );
    }
    return ALLOW;
  }

  ddev(args: Word[], cwd: string | null): GuardDecision {
    const sub = args.find((w) => !w.text.startsWith('-'));
    const flags = args.map((w) => w.text);
    if (sub?.text !== 'delete' && !flags.includes('--remove-data'))
      return ALLOW;
    const refuse = (what: string) =>
      deny(
        'ddev-other',
        `ddev ${sub?.text} would remove ${what}`,
        `remove data only of this run's own project${this.ctx.ddevProject ? ` (${this.ctx.ddevProject})` : ''}, from its worktree`,
      );
    if (flags.includes('--all') || flags.includes('-a'))
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
    const words = args
      .filter((w) => !w.text.startsWith('-'))
      .map((w) => w.text);
    const [group, action] = words;
    const refuse = (what: string) =>
      deny(
        'forge-delete',
        `${name} ${what} would close, merge or delete remote work`,
        'leave closing, merging and deleting to a human or the review state',
      );
    const closes: Record<string, string[]> = {
      pr: ['close', 'merge', 'delete'],
      mr: ['close', 'merge', 'delete'],
      release: ['delete', 'delete-asset'],
      repo: ['delete', 'archive'],
      label: ['delete'],
    };
    if (group && action && closes[group]?.includes(action))
      return refuse(`${group} ${action}`);
    if (group !== 'api') return ALLOW;
    const flags = args.map((w) => w.text);
    let method = 'GET';
    flags.forEach((f, i) => {
      if (f === '-X' || f === '--method') method = flags[i + 1] ?? method;
      else if (f.startsWith('--method=')) method = f.slice(9);
      else if (f.startsWith('-X') && f.length > 2) method = f.slice(2);
    });
    method = method.toUpperCase();
    if (method === 'DELETE') return refuse('api -X DELETE');
    const ref = words[1] ? /\/git\/refs\/heads\/(.+)$/.exec(words[1]) : null;
    if (method !== 'GET' && ref && !this.owned(ref[1] as string))
      return refuse(`api -X ${method} on another branch`);
    return ALLOW;
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
