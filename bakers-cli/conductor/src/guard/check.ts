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
  /** The shell's environment sets `CDPATH`, so a relative `cd` may go elsewhere. */
  cdpath?: boolean;
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
  /** Stands for what `find -L` finds, so a symlink is followed. */
  follow?: boolean;
}

/** One simple command, or a subshell's `(` or `)`. */
interface Segment {
  words: Word[];
  /** The operator after it: `&&`, `||`, `;`, `|`, `&`, a newline or ``. */
  end: string;
  paren?: '(' | ')';
  /** The scripts of its `$(…)` and backtick substitutions, which run first. */
  subs: string[];
}

const ALLOW: GuardDecision = { allow: true };
/** Stand-ins for `$PWD` (the tracked cwd), `$HOME`/`~` and `$TMPDIR`, replaced at check time. */
const PWD = '\0PWD\0';
const HOME = '\0HOME\0';
const TMPDIR = '\0TMPDIR\0';
/** Variables a command may reassign, which then stop being known. */
const TRACKED = ['HOME', 'TMPDIR', 'PWD', 'CDPATH'];
/** A command the guard cannot split as the shell would. */
class Unparsable extends Error {}
const DELETERS = new Set(['rm', 'rmdir', 'unlink', 'shred']);
const SHELLS = new Set([
  'bash',
  'sh',
  'zsh',
  'dash',
  'ksh',
  'mksh',
  'ash',
  'fish',
  'csh',
  'tcsh',
]);
/** Shell options that take a value. */
const SHELL_VALUES = ['-o', '+o', '-O', '+O', '--rcfile', '--init-file'];
interface Wrapper {
  /** Options that take a value. */
  values: string[];
  /** Positionals before the command. */
  positionals?: number;
  /** Options whose following words are a command line to run. */
  scripts?: string[];
  /** Joins its words into a command line for `sh -c`. */
  joins?: boolean;
  /** Options that set the wrapped command's working directory. */
  chdir?: string[];
}
/** Commands that run the command after their options. */
const WRAPPERS: Record<string, Wrapper> = {
  sudo: {
    values: ['-u', '-g', '-C', '-h', '-p', '-U', '-r', '-t', '-T'],
    chdir: ['-D', '--chdir'],
  },
  doas: { values: ['-u', '-C'] },
  env: {
    values: ['-u', '--unset'],
    chdir: ['-C', '--chdir'],
    scripts: ['-S', '--split-string'],
  },
  su: {
    values: ['-s', '--shell', '-g', '--group'],
    scripts: ['-c', '--command'],
  },
  script: {
    values: ['-T', '-I', '-O', '-B', '-t'],
    scripts: ['-c', '--command'],
  },
  command: { values: [] },
  builtin: { values: [] },
  exec: { values: ['-a'] },
  nohup: { values: [] },
  time: { values: ['-f', '-o'] },
  nice: { values: ['-n', '--adjustment'] },
  ionice: { values: ['-c', '-n', '-p'] },
  stdbuf: { values: ['-i', '-o', '-e'] },
  timeout: { values: ['-s', '--signal', '-k', '--kill-after'], positionals: 1 },
  gtimeout: {
    values: ['-s', '--signal', '-k', '--kill-after'],
    positionals: 1,
  },
  setsid: { values: [] },
  watch: { values: ['-n', '--interval', '-q', '--equexit'], joins: true },
  flock: {
    values: ['-w', '--timeout', '-E', '--conflict-exit-code'],
    positionals: 1,
    scripts: ['-c', '--command'],
  },
  caffeinate: { values: ['-t', '-w'] },
  chronic: { values: [] },
  unbuffer: { values: [] },
  busybox: { values: [] },
  arch: { values: [] },
  taskset: { values: [], positionals: 1 },
  chrt: { values: [], positionals: 1 },
  strace: {
    values: [
      '-e',
      '-o',
      '-p',
      '-s',
      '-u',
      '-E',
      '-P',
      '-I',
      '-b',
      '-S',
      '-X',
      '-a',
    ],
  },
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
  'always',
  // zsh precommand modifiers.
  'noglob',
  'nocorrect',
  '-',
]);
/** Brace expansion; a quoted part (`{a,' '/../x}`) is still inside the braces. */
const BRACE_PART = `([^\\s{}'"]|'[^']*'|"[^"]*")*`;
const BRACE = new RegExp(`^\\{${BRACE_PART}(,|\\.\\.)${BRACE_PART}\\}`);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
/** Environment that points git at another repository. */
const GIT_ENV = /^GIT_(DIR|WORK_TREE|COMMON_DIR|NAMESPACE)/;
/** Environment that gives git configuration, aliases or commands to run. */
const GIT_RUNS =
  /^GIT_(CONFIG|SSH|EXEC_PATH|EXTERNAL_DIFF|PAGER|EDITOR|SEQUENCE_EDITOR|ASKPASS|PROXY_COMMAND|TEMPLATE_DIR|ALTERNATE)/;
/** `git -c` keys that run nothing and change no push. */
const SAFE_GIT_KEYS =
  /^(user|color|advice|i18n|log|column)\.|^(commit|tag)\.gpgsign$|^init\.defaultbranch$|^core\.(quotepath|autocrlf|safecrlf|filemode)$|^pull\.(rebase|ff)$|^merge\.ff$|^safe\.directory$|^gc\.auto$/i;
/** git global options without a value. */
const GIT_FLAGS = new Set([
  '-p',
  '-P',
  '-v',
  '-h',
  '--paginate',
  '--no-pager',
  '--bare',
  '--no-replace-objects',
  '--no-lazy-fetch',
  '--no-optional-locks',
  '--no-advice',
  '--literal-pathspecs',
  '--glob-pathspecs',
  '--noglob-pathspecs',
  '--icase-pathspecs',
  '--version',
  '--help',
  '--exec-path',
  '--html-path',
  '--man-path',
  '--info-path',
]);
/** Subcommands that leave the same branch checked out (as far as the guard tracks). */
const KEEPS_HEAD = new Set([
  'add',
  'am',
  'apply',
  'archive',
  'blame',
  'branch',
  'cat-file',
  'check-ignore',
  'checkout',
  'cherry',
  'cherry-pick',
  'clean',
  'clone',
  'commit',
  'config',
  'count-objects',
  'describe',
  'diff',
  'diff-files',
  'diff-index',
  'diff-tree',
  'fetch',
  'for-each-ref',
  'format-patch',
  'fsck',
  'gc',
  'grep',
  'hash-object',
  'help',
  'init',
  'log',
  'ls-files',
  'ls-remote',
  'ls-tree',
  'maintenance',
  'merge',
  'merge-base',
  'mv',
  'name-rev',
  'notes',
  'prune',
  'pull',
  'push',
  'range-diff',
  'rebase',
  'reflog',
  'remote',
  'repack',
  'reset',
  'restore',
  'rev-list',
  'rev-parse',
  'revert',
  'rm',
  'shortlog',
  'show',
  'show-ref',
  'stash',
  'status',
  'submodule',
  'switch',
  'symbolic-ref',
  'tag',
  'update-index',
  'update-ref',
  'version',
  'worktree',
]);
/** Subcommands where a computed word could be the option that discards work. */
const DISCARDS = new Set([
  'reset',
  'clean',
  'branch',
  'update-ref',
  'worktree',
  'stash',
  'config',
  'remote',
  'checkout',
  'restore',
  'switch',
]);
/** Config keys that change what `git push` sends or where, or load other configuration. */
const PUSH_KEYS = /^(alias|remote|push|url|include|includeif)\./i;

interface Heredoc {
  delim: string;
  strip: boolean;
  quoted: boolean;
}

/**
 * Split a command into segments of words, one per simple command. Nested, it
 * reads a `$(…)` body from `from` and stops at its closing `)`. Throws
 * Unparsable on what it cannot split as the shell would.
 */
function tokenize(
  command: string,
  from = 0,
  nested = false,
): { segments: Segment[]; end: number } {
  const segments: Segment[] = [];
  let words: Word[] = [];
  let subs: string[] = [];
  let word: Word | null = null;
  let heredocs: Heredoc[] = [];
  let depth = 0;
  const cur = () => {
    word ??= { text: '', dynamic: false, glob: false };
    return word;
  };
  const endWord = () => {
    if (word) words.push(word);
    word = null;
  };
  const endSegment = (end: string) => {
    endWord();
    if (words.length || subs.length) segments.push({ words, end, subs });
    else {
      const last = segments.at(-1);
      if (last && !last.end) last.end = end;
    }
    words = [];
    subs = [];
  };
  const vars: Record<string, string> = { HOME, TMPDIR, PWD };
  let i = from;
  // Reads `$…` at i; returns the expansion or null for an unknown one.
  const dollar = (): string | null => {
    const next = command[i + 1];
    if (next === "'") {
      // `$'…'` decodes escapes the guard does not follow; `\'` does not end it.
      for (i += 2; command[i] !== "'"; i += command[i] === '\\' ? 2 : 1)
        if (i >= command.length) throw new Unparsable("an unterminated $'");
      i++;
      return null;
    }
    if (next === '(') {
      const { end } = tokenize(command, i + 2, true);
      subs.push(command.slice(i + 2, end));
      i = end + 1;
      return null;
    }
    const m =
      /^\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*)|([?$#!@*0-9-]))/.exec(
        command.slice(i),
      );
    if (!m) {
      if (next === '{') {
        // `${R:-rm}` and other parameter operators: a value the guard does not
        // compute, and one that hides no substitution or quote.
        const end = command.indexOf('}', i);
        const body = command.slice(i + 2, end);
        if (end === -1 || /[$`'"\\{]/.test(body))
          throw new Unparsable('a parameter expansion');
        i = end + 1;
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
    let body = '';
    for (i++; command[i] !== '`'; i++) {
      if (i >= command.length) throw new Unparsable('an unterminated backtick');
      if (command[i] === '\\' && '$`\\'.includes(command[i + 1] ?? '')) i++;
      body += command[i];
    }
    subs.push(body);
    i++;
  };
  // A heredoc: `<<[-]delim` here, its body after the line ends.
  const heredoc = () => {
    i += 2;
    const strip = command[i] === '-';
    if (strip) i++;
    while (command[i] === ' ' || command[i] === '\t') i++;
    let raw = '';
    while (i < command.length && !/[\s;&|()<>]/.test(command[i] as string))
      raw += command[i++];
    if (!raw) throw new Unparsable('a heredoc without a delimiter');
    heredocs.push({
      delim: raw.replace(/['"\\]/g, ''),
      strip,
      quoted: /['"\\]/.test(raw),
    });
  };
  const bodies = () => {
    for (const h of heredocs) {
      let body = '';
      while (i < command.length) {
        let eol = command.indexOf('\n', i);
        if (eol === -1) eol = command.length;
        const line = command.slice(i, eol);
        i = eol + 1;
        if ((h.strip ? line.replace(/^\t+/, '') : line) === h.delim) break;
        body += line;
      }
      // An unquoted body runs its substitutions; the guard does not read them there.
      if (!h.quoted && /\$\(|`/.test(body))
        throw new Unparsable('a substitution in a heredoc');
    }
    heredocs = [];
  };
  while (i < command.length) {
    const c = command[i] as string;
    if (c === ' ' || c === '\t') {
      endWord();
      i++;
    } else if (c === '#' && !word) {
      // A comment runs to the end of the line.
      while (i < command.length && command[i] !== '\n') i++;
    } else if (c === '\n' || c === ';') {
      endSegment(c);
      i++;
      if (c === '\n') bodies();
    } else if (c === ')' && nested && depth === 0) {
      endSegment('');
      return { segments, end: i };
    } else if (c === '(' || c === ')') {
      depth += c === '(' ? 1 : -1;
      endSegment(c);
      segments.push({ words: [], end: '', paren: c, subs: [] });
      i++;
    } else if (c === '&' || c === '|') {
      if (c === '&' && command[i + 1] === '>') {
        endWord();
        words.push({ text: '&>', dynamic: false, glob: false, op: 'redirect' });
        i += command[i + 2] === '>' ? 3 : 2;
      } else {
        const op = command[i + 1] === c ? c + c : c;
        endSegment(op);
        i += op.length;
      }
    } else if (c === '<' && command[i + 1] === '<' && command[i + 2] !== '<') {
      if (word && /^\d+$/.test((word as Word).text)) word = null;
      endWord();
      heredoc();
    } else if (c === '>' || c === '<') {
      // A file descriptor number before the operator belongs to it.
      if (word && /^\d+$/.test((word as Word).text)) word = null;
      endWord();
      words.push({ text: c, dynamic: false, glob: false, op: 'redirect' });
      i++;
      // `>|` overwrites despite noclobber; `<<<` is a here-string.
      if (c === '>' && command[i] === '|') i++;
      while ('<>&'.includes(command[i] ?? '-')) i++;
    } else if (c === "'") {
      const end = command.indexOf("'", i + 1);
      if (end === -1) throw new Unparsable('an unterminated quote');
      cur().text += command.slice(i + 1, end);
      i = end + 1;
    } else if (c === '"') {
      const w = cur();
      for (i++; command[i] !== '"'; ) {
        if (i >= command.length) throw new Unparsable('an unterminated quote');
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
    } else if (c === '~' && word && /[=:]$/.test((word as Word).text)) {
      // bash expands `~` after `=` or `:` in any word, zsh only in an assignment.
      cur().dynamic = true;
      i++;
    } else if (c === '~' && !word) {
      // `~user`, `~+` and `~-` are directories the guard does not know.
      if (
        i + 1 === command.length ||
        ' \t\n;&|/)'.includes(command[i + 1] as string)
      )
        cur().text += HOME;
      else cur().dynamic = true;
      i++;
    } else {
      const w = cur();
      if ('*?['.includes(c)) w.glob = true;
      // Brace expansion (`{a,../x}`, `{1..3}`) yields words the guard does not expand.
      if (c === '{' && BRACE.test(command.slice(i))) w.dynamic = true;
      w.text += c;
      i++;
    }
  }
  if (nested) throw new Unparsable('an unterminated $(');
  endSegment('');
  bodies();
  return { segments, end: i };
}

/** `text` names the variable other than by expanding it: an assignment, export, read or loop. */
const mentions = (text: string, name: string) =>
  new RegExp(`(^|[^$\\w])${name}(?!\\w)`).test(
    text.replace(new RegExp(`\\$\\{${name}\\}`, 'g'), ''),
  );

/** `p` with `..` applied after each symlink before it is followed, as the kernel does. */
function physical(p: string): string {
  let at = '/';
  for (const part of p.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      try {
        at = realpathSync(at);
      } catch {
        // A missing directory fails the command; its text is all there is.
      }
      at = dirname(at);
    } else at = join(at, part);
  }
  return at;
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

/** A command word's name; zsh's `=rm` names the `rm` on the PATH. */
const verbName = (w: Word) =>
  basename(
    w.text.length > 1 && w.text.startsWith('=') ? w.text.slice(1) : w.text,
  );

const inside = (p: string, dir: string) =>
  p === dir || p.startsWith(dir.endsWith('/') ? dir : `${dir}/`);

const deny = (
  rule: string,
  reason: string,
  alternative: string,
): GuardDecision => ({ allow: false, rule, reason, alternative });

/** `t` names one of `full`, also as the abbreviation git accepts for any unambiguous prefix. */
const longOpt = (t: string, ...full: string[]) => {
  const name = t.split('=')[0] as string;
  return name.length > 2 && full.some((f) => f.startsWith(name));
};

const unresolvable = (what: string) =>
  deny(
    'unresolvable',
    `the guard cannot resolve ${what}`,
    'write the target as a literal path inside the worktree or $TMPDIR',
  );

class Checker {
  /** The checked-out branch as the command goes on; null when unknown. */
  private head: string | null;
  /** `GIT_*` variables the command so far exported or assigned for the rest of it. */
  private gitVars = new Set<string>();
  /** TRACKED variables the command may have reassigned. */
  private changed = new Set<string>();

  constructor(private readonly ctx: GuardContext) {
    this.head = ctx.head ?? null;
    if (ctx.cdpath) this.changed.add('CDPATH');
  }

  /** Where the variables point at check time; null when the command may have reassigned one. */
  expand(text: string, cwd: string | null): string | null {
    const values: [string, string, string | null][] = [
      [PWD, 'PWD', cwd],
      [HOME, 'HOME', this.ctx.home],
      [TMPDIR, 'TMPDIR', this.ctx.tmpdir],
    ];
    for (const [marker, name, value] of values) {
      if (!text.includes(marker)) continue;
      if (value === null || this.changed.has(name)) return null;
      text = text.replaceAll(marker, value);
    }
    return text;
  }

  /**
   * A word as an absolute path, or null when it depends on the shell. With
   * `follow`, a trailing `/` or a glob, a final symlink is resolved too.
   */
  path(word: Word, cwd: string | null, follow = false): string | null {
    if (word.dynamic) return null;
    const through =
      follow || word.follow || word.glob || /\/\.?$/.test(word.text);
    let text = this.expand(word.text, cwd);
    if (text === null) return null;
    if (word.glob) {
      // The directory the pattern expands in; a `..` after a glob climbs out of what it matched.
      const at = text.search(/[*?[]/);
      if (text.slice(at).includes('..')) return null;
      text = text.slice(0, text.lastIndexOf('/', at) + 1) || '.';
    }
    if (!isAbsolute(text)) {
      if (cwd === null) return null;
      text = `${cwd}/${text}`;
    }
    return through ? followed(physical(text)) : canonical(physical(text));
  }

  deletable(p: string): boolean {
    return inside(p, this.ctx.worktree) || inside(p, this.ctx.tmpdir);
  }

  owned(ref: string): boolean {
    const name = ref.replace(/^refs\/heads\//, '');
    const { branch } = this.ctx;
    return name === branch || name.startsWith(`${branch}-`);
  }

  headOwned(): boolean {
    return this.head !== null && this.owned(this.head);
  }

  pushAlternative(): string {
    const own = this.ctx.branch;
    return `push only this run's branch without force: git push -u origin HEAD (on ${own}) or git push origin HEAD:${own} (or a new ${own}-<suffix> branch)`;
  }

  run(command: string, cwd: string | null): GuardDecision {
    for (const name of TRACKED)
      if (mentions(command, name)) this.changed.add(name);
    // A subshell restores the directory; a cd that may have failed leaves it
    // unknown after the first operator that is not `&&`.
    const stack: { cwd: string | null; uncertain: boolean }[] = [];
    let uncertain = false;
    let before = '';
    for (const { words: segment, end, paren, subs } of tokenize(command)
      .segments) {
      if (paren === '(') {
        stack.push({ cwd, uncertain });
        continue;
      }
      if (paren === ')') {
        const outer = stack.pop();
        cwd = outer ? outer.cwd : null;
        uncertain = outer?.uncertain ?? false;
        before = end;
        continue;
      }
      if (uncertain && before !== '&&') {
        cwd = null;
        uncertain = false;
      }
      const piped = before === '|' || end === '|';
      before = end;
      for (const sub of subs) {
        const d = this.run(sub, cwd);
        if (!d.allow) return d;
      }
      const words = segment.filter((w, i) => !w.op && !segment[i - 1]?.op);
      const assigned: Word[] = [];
      const at = { cwd };
      const stripped = this.unwrap(words, assigned, at);
      if (stripped) return stripped;
      const verb = words[0];
      const name = verb ? verbName(verb) : '';
      const args = words.slice(1);
      // An assignment alone or an export holds for the rest of the command.
      const exported = [
        'export',
        'declare',
        'typeset',
        'local',
        'readonly',
      ].includes(name)
        ? args.filter((w) => /^[A-Za-z_]/.test(w.text))
        : [];
      // A value may be a command line git or another program runs (`EDITOR`, `GIT_SSH_COMMAND`).
      for (const w of [...assigned, ...exported]) {
        const d = this.value(w, cwd);
        if (!d.allow) return d;
      }
      const vars = (ws: Word[]) =>
        ws
          .map((w) => w.text.split('=')[0] as string)
          .filter((n) => n.startsWith('GIT_'));
      for (const n of vars(verb ? exported : assigned)) this.gitVars.add(n);
      if (!verb) continue;
      // A computed command name could be any verb, a destructive one included.
      if (verb.dynamic) return unresolvable('the command a computed name runs');
      const sticky = this.gitVars;
      this.gitVars = new Set([...sticky, ...vars(assigned)]);
      if (name === 'cd' || name === 'pushd' || name === 'popd') {
        const target = args.find((w) => !w.text.startsWith('-'));
        // A pipeline runs cd in a subshell (or not, in zsh); `-`, `+N` and popd name a stack entry.
        // With CDPATH set, a bare relative directory may be found elsewhere.
        const known =
          !piped &&
          name !== 'popd' &&
          !args.some((w) => w.text === '-') &&
          !target?.text.startsWith('+') &&
          !(
            this.changed.has('CDPATH') &&
            target &&
            !/^(\/|\.\.?(\/|$)|\0)/.test(target.text)
          ) &&
          (target !== undefined || name === 'cd');
        cwd = !known
          ? null
          : target
            ? this.path({ ...target, glob: false }, cwd)
            : this.expand(HOME, cwd);
        uncertain = true;
        this.gitVars = sticky;
        continue;
      }
      const d = this.simple(name, args, at.cwd);
      this.gitVars = sticky;
      if (!d.allow) return d;
    }
    return ALLOW;
  }

  /** An assignment's value checked as the command line it may become. */
  value(w: Word, cwd: string | null): GuardDecision {
    const v = w.text.slice(w.text.indexOf('=') + 1);
    if (w.dynamic || !w.text.includes('=') || !v) return ALLOW;
    try {
      return this.run(v, cwd);
    } catch (err) {
      // A value no shell can split is not a command line it runs.
      if (err instanceof Unparsable) return ALLOW;
      throw err;
    }
  }

  /**
   * Strip grammar words, assignments and wrappers from `words` down to the
   * command, in place; a refusal when a wrapper runs a string it refuses.
   * A wrapper that changes the directory (`env -C`) sets `at.cwd`.
   */
  unwrap(
    words: Word[],
    assigned: Word[],
    at: { cwd: string | null },
  ): GuardDecision | null {
    // A wrapper that runs a string as a command line (`env -S`, `flock -c`, `watch`).
    const script = (rest: Word[], what: string): GuardDecision | null => {
      if (rest.some((w) => w.dynamic))
        return unresolvable(`the command ${what} runs`);
      const d = this.run(rest.map((w) => w.text).join(' '), at.cwd);
      words.length = 0;
      return d.allow ? null : d;
    };
    for (let changed = true; changed && words[0]; ) {
      changed = true;
      const first = words[0] as Word;
      const name = verbName(first);
      if (GRAMMAR.has(first.text)) words.shift();
      else if (first.text === 'function') {
        // `function f { …; }`; zsh's anonymous `function { …; }` has no name.
        words.shift();
        if (words[0] && words[0].text !== '{') words.shift();
      } else if (first.text === 'repeat') words.splice(0, 2);
      else if (first.text === 'coproc') {
        words.shift();
        if (words[1]?.text === '{') words.shift();
      } else if (ASSIGNMENT.test(first.text)) {
        assigned.push(first);
        words.shift();
      } else if (Object.hasOwn(WRAPPERS, name)) {
        const spec = WRAPPERS[name] as Wrapper;
        words.shift();
        let positionals = spec.positionals ?? 0;
        while (words[0]) {
          const t = words[0].text;
          const chdir = spec.chdir?.find(
            (o) => t === o || t.startsWith(o.length === 2 ? o : `${o}=`),
          );
          if (spec.scripts?.includes(t))
            return script(words.slice(1), `${name} ${t}`);
          if (chdir) {
            const dir =
              t === chdir
                ? words[1]
                : {
                    ...words[0],
                    text: t.slice(chdir.length).replace(/^=/, ''),
                  };
            at.cwd = dir ? this.path({ ...dir, glob: false }, at.cwd) : null;
            words.splice(0, t === chdir ? 2 : 1);
          } else if (spec.values.includes(t)) words.splice(0, 2);
          else if (t.startsWith('-') || ASSIGNMENT.test(t)) {
            if (ASSIGNMENT.test(t)) assigned.push(words[0]);
            words.shift();
          } else if (positionals > 0) {
            positionals--;
            words.shift();
          } else break;
        }
        if (spec.joins && words.length) return script([...words], name);
      } else changed = false;
    }
    return null;
  }

  /** A command another command runs (`xargs`, `find -exec`): no cd, no environment. */
  exec(words: Word[], cwd: string | null): GuardDecision {
    const at = { cwd };
    const d = this.unwrap(words, [], at);
    if (d) return d;
    const verb = words[0];
    if (!verb) return ALLOW;
    if (verb.dynamic) return unresolvable('the command a computed name runs');
    return this.simple(verbName(verb), words.slice(1), at.cwd);
  }

  simple(name: string, args: Word[], cwd: string | null): GuardDecision {
    if (name === 'trap') {
      const action = args[0];
      if (!action || (!action.dynamic && action.text.startsWith('-')))
        return ALLOW;
      return action.dynamic
        ? unresolvable('the command trap runs')
        : this.run(action.text, cwd);
    }
    if (SHELLS.has(name)) {
      let i = 0;
      let inline = false;
      let stdin = false;
      for (; i < args.length; i++) {
        const w = args[i] as Word;
        if (w.dynamic || !/^[-+]./.test(w.text)) break;
        if (w.text === '--') {
          i++;
          break;
        }
        if (SHELL_VALUES.includes(w.text)) i++;
        else if (/^-[a-zA-Z]*c/.test(w.text)) inline = true;
        else if (/^-[a-zA-Z]*s/.test(w.text)) stdin = true;
      }
      const operand = args[i];
      if (inline)
        return operand && !operand.dynamic
          ? this.run(operand.text, cwd)
          : unresolvable(`the script ${name} -c runs`);
      // Code on stdin, a pipe or a here-string is out of the guard's sight, like eval's.
      if (!operand || stdin)
        return unresolvable(`the commands ${name} reads from its input`);
      // A script file is out of the guard's reach, like an interpreter.
      return operand.dynamic ? unresolvable(`the script ${name} runs`) : ALLOW;
    }
    if (name === 'source' || name === '.')
      return args[0] && !args[0].dynamic
        ? ALLOW
        : unresolvable(`the commands ${name} reads`);
    if (name === 'eval') {
      if (args.some((w) => w.dynamic))
        return unresolvable('the command eval runs');
      return this.run(args.map((w) => w.text).join(' '), cwd);
    }
    // A new name for a command the guard would no longer recognise.
    if (
      (name === 'hash' &&
        args.some((w) => w.text === '-p' || w.text.includes('='))) ||
      (name === 'alias' && args.some((w) => w.dynamic || w.text.includes('=')))
    )
      return unresolvable(`the command ${name} gives another name`);
    if (DELETERS.has(name)) return this.deleting(name, args, cwd);
    if (name === 'find') return this.find(args, cwd);
    if (name === 'xargs') return this.xargs(args, cwd);
    if (name === 'git') return this.git(args, cwd);
    if (name === 'ddev') return this.ddev(args, cwd);
    if (name === 'gh' || name === 'glab') return this.forge(name, args);
    // A command the guard does not know may run its arguments (`parallel`,
    // `pnpm exec`): a destructive verb among them is checked as that command.
    const k = args.findIndex(
      (w) =>
        !w.dynamic &&
        (DESTRUCTIVE_VERBS.includes(basename(w.text)) ||
          DELETERS.has(w.text.split(/\s/)[0] as string)),
    );
    if (k === -1) return ALLOW;
    const [w, ...rest] = args.slice(k) as [Word, ...Word[]];
    const head = /\s/.test(w.text)
      ? (tokenize(w.text).segments[0]?.words ?? [])
      : [w];
    return this.exec([...head, ...rest], cwd);
  }

  /** The command xargs runs, with arguments the guard cannot know. */
  xargs(args: Word[], cwd: string | null): GuardDecision {
    const values = ['-I', '-n', '-P', '-L', '-d', '-E', '-s', '-a'];
    let i = 0;
    while (i < args.length && (args[i] as Word).text.startsWith('-'))
      i += values.includes((args[i] as Word).text) ? 2 : 1;
    if (!args[i]) return ALLOW;
    const unknown: Word = { text: '', dynamic: true, glob: false };
    return this.exec([...args.slice(i), unknown], cwd);
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
      // A computed word may split into options and paths: a target either way.
      ...(end === -1 ? args : args.slice(0, end)).filter(
        (w) => w.dynamic || !w.text.startsWith('-'),
      ),
      ...(end === -1 ? [] : args.slice(end + 1)),
    ];
    return this.targets(name, paths, cwd);
  }

  find(args: Word[], cwd: string | null): GuardDecision {
    const starts: Word[] = [];
    let follow = false;
    let i = 0;
    // Options before the start paths; BSD `-f <path>` names one.
    for (; i < args.length; i++) {
      const t = (args[i] as Word).text;
      if (t === '--') {
        i++;
        break;
      }
      if (t === '-f' || t === '-D') {
        const v = args[++i];
        if (t === '-f' && v) starts.push(v);
      } else if (/^-([HLPEXdsx]+|O\d*)$/.test(t)) {
        if (/[HL]/.test(t)) follow = true;
      } else break;
    }
    for (; i < args.length && !/^[-(!]/.test((args[i] as Word).text); i++)
      starts.push(args[i] as Word);
    if (!starts.length) starts.push({ text: '.', dynamic: false, glob: false });
    const expr = args.slice(i);
    for (let j = 0; j < expr.length; j++) {
      const t = (expr[j] as Word).text;
      if (t === '-delete') {
        const d = this.targets('find', starts, cwd, follow);
        if (!d.allow) return d;
      } else if (['-exec', '-execdir', '-ok', '-okdir'].includes(t)) {
        let end = expr.findIndex(
          (w, k) => k > j && (w.text === ';' || w.text === '+'),
        );
        if (end === -1) end = expr.length;
        // `{}` stands for what find finds: the start paths, followed with -L.
        const clause = expr.slice(j + 1, end).flatMap((w) =>
          w.text === '{}'
            ? starts.map((s) => ({ ...s, follow }))
            : // `{}/x` names a path under what find finds, which the guard does not know.
              [w.text.includes('{}') ? { ...w, dynamic: true } : w],
        );
        const d = this.exec(clause, cwd);
        if (!d.allow) return d;
        j = end;
      }
    }
    return ALLOW;
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
        const key = (w?.text ?? '').replace(/^--config-env=/, '').split('=')[0];
        // Most keys can name a command git runs through sh -c, or change what push sends.
        if (!w || w.dynamic || !SAFE_GIT_KEYS.test(key ?? ''))
          return deny(
            'git-config',
            `git ${t} ${w?.text ?? ''} could run a command or change what git push sends`,
            'run git without -c, or with -c only for user.*, color.* and similar display keys',
          );
      } else if (t === '--attr-source' || t === '--super-prefix') i++;
      else if (t === '--namespace' || t.startsWith('--namespace=')) {
        return deny(
          'git-push',
          `git ${t} changes which refs git reads and pushes`,
          this.pushAlternative(),
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
      // `--exec-path=<dir>` runs subcommands from it; an unknown option may take a value.
      else if (!GIT_FLAGS.has(t) && !/^--(attr-source|list-cmds)=/.test(t))
        return unresolvable(`the git option ${t}`);
    }
    const env = [...this.gitVars];
    if (env.some((n) => GIT_RUNS.test(n)))
      return deny(
        'git-config',
        `git with ${env.filter((n) => GIT_RUNS.test(n)).join(', ')} set could run a command or alias the guard does not see`,
        'run git without GIT_CONFIG_* or GIT_*_COMMAND variables',
      );
    if (args[i]?.dynamic) return unresolvable('the git subcommand');
    const sub = args[i]?.text;
    const rest = args.slice(i + 1);
    if (sub !== undefined && DISCARDS.has(sub) && rest.some((w) => w.dynamic))
      return unresolvable(`the options of git ${sub}`);
    if (sub !== undefined && !KEEPS_HEAD.has(sub)) this.head = null;
    const flags = rest.map((w) => w.text);
    const own = this.ctx.branch;
    // The tree a destructive subcommand acts on.
    const tree =
      workTree !== undefined
        ? workTree
        : gitDir || env.some((n) => GIT_ENV.test(n))
          ? null
          : dir;
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
          this.pushAlternative(),
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
        return flags.some(
          (f) =>
            longOpt(f, '--force', '--discard-changes') ||
            /^-[a-zA-Z]*f/.test(f),
        )
          ? inTree()
          : ALLOW;
      }
      case 'rebase':
        // `git rebase <upstream> <branch>` checks the branch out first.
        if (positional.length > 1) this.head = null;
        return ALLOW;
      case 'symbolic-ref':
        if (
          positional.length > 1 ||
          flags.some((f) => f === '-d' || longOpt(f, '--delete'))
        )
          this.head = null;
        return ALLOW;
      case 'branch': {
        const destructive = flags.some(
          (f) =>
            longOpt(f, '--delete', '--force', '--move') ||
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
        if (flags.some((f) => longOpt(f, '--stdin')))
          return unresolvable('the refs git update-ref --stdin changes');
        const ref = positional[0];
        if (!flags.includes('-d')) {
          const mine =
            ref &&
            !ref.dynamic &&
            (ref.text === 'HEAD'
              ? this.headOwned()
              : ref.text.startsWith('refs/heads/') && this.owned(ref.text));
          return mine
            ? ALLOW
            : deny(
                'git-update-ref',
                `git update-ref would move ${ref?.text ?? 'a ref'}, which this run does not own`,
                `move only refs/heads/${own}`,
              );
        }
        return ref && !ref.dynamic && this.owned(ref.text)
          ? ALLOW
          : deny(
              'git-update-ref',
              `git update-ref -d would delete ${ref?.text ?? 'a ref'}, which this run does not own`,
              `delete only refs/heads/${own}`,
            );
      }
      case 'reset':
        return flags.some((f) => longOpt(f, '--hard')) ? inTree() : ALLOW;
      case 'clean':
        return inTree();
      case 'checkout':
      case 'restore': {
        const end = rest.findIndex((w) => w.text === '--');
        if (sub === 'checkout' && end === -1) {
          // A branch switch, or a path the guard reads as one: unknown either way.
          const to = named(['-b', '-B', '--orphan']) ?? positional[0];
          if (flags.includes('-')) this.head = null;
          else if (to) this.head = to.dynamic ? null : to.text;
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
        if (positional[0]?.text === 'branch') this.head = null;
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
    const values = [
      '-f',
      '--file',
      '--blob',
      '--type',
      '--default',
      '--comment',
      '--value',
    ];
    const positional = args.filter(
      (w, i) =>
        !w.text.startsWith('-') && !values.includes(args[i - 1]?.text ?? ''),
    );
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
    // Keys beyond display and submodule or branch settings can name a command git runs.
    return edits ||
      !key ||
      key.dynamic ||
      PUSH_KEYS.test(key.text) ||
      !(SAFE_GIT_KEYS.test(key.text) || /^(submodule|branch)\./i.test(key.text))
      ? deny(
          'git-config',
          `git config would change ${key?.text ?? 'the configuration'}, which can run a command or decide what git push sends`,
          'leave the configuration as it is, apart from user.*, color.* and similar display keys',
        )
      : ALLOW;
  }

  push(args: Word[], tree: string | null): GuardDecision {
    const refuse = (reason: string) =>
      deny('git-push', reason, this.pushAlternative());
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
        if (longOpt(t, '--force', '--force-with-lease', '--force-if-includes'))
          return refuse(`git push ${t} would force-push`);
        if (longOpt(t, '--delete')) deleting = true;
        else if (
          longOpt(t, '--mirror', '--all', '--branches', '--tags', '--prune')
        )
          return refuse(
            `git push ${t} would change or delete remote refs beyond this run's branch`,
          );
        if (longOpt(t, '--repo'))
          return refuse(
            'git push --repo pushes to a remote the guard does not check',
          );
        if (longOpt(t, '--receive-pack', '--exec'))
          return refuse(`git push ${t} runs a command on the remote side`);
        if (t === '--push-option') i++;
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
      if (dst === 'HEAD') {
        if (this.head === null)
          return unresolvable('the branch HEAD points at');
        if (!this.headOwned())
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
    // `--remove-data=true` sets the flag as well.
    const flags = args.map((w) => w.text.split('=')[0] as string);
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
    let fromFile = false;
    for (let i = 0; i < args.length; i++) {
      const t = (args[i] as Word).text;
      const value = args[i + 1]?.text ?? '';
      if (t === '-X' || t === '--method') method = value;
      else if (t.startsWith('--method=')) method = t.slice(9);
      else if (/^-X./.test(t)) method = t.slice(2);
      if (/^(-f|-F|--(field|raw-field|input)(=|$))/.test(t)) fields = true;
      // `-F key=@file` reads the value from a file.
      const typed = /^(-F|--field)$/.test(t)
        ? value
        : /^(?:-F|--field=)(.+)$/.exec(t)?.[1];
      if (typed !== undefined && /^[^=]*=@/.test(typed)) fromFile = true;
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
    if (group === 'alias' && (action === 'set' || action === 'import'))
      return deny(
        'forge-alias',
        `${name} alias ${action} could give a refused command another name`,
        `run the ${name} command itself`,
      );
    if ((group === 'pr' || group === 'mr') && action === 'checkout')
      this.head = null;
    if (group && action && closes[group]?.includes(action))
      return refuse(`${group} ${action}`);
    if (group !== 'api') return ALLOW;
    // gh and glab send a request with fields as a POST.
    const verb = (method ?? (fields ? 'POST' : 'GET')).toUpperCase();
    if (verb === 'GET') return ALLOW;
    const texts = args.map((w) => w.text);
    if (
      texts.some((t) => t === '--input' || t.startsWith('--input=')) ||
      fromFile ||
      args.some((w) => w.dynamic)
    )
      return unresolvable(`the body ${name} api sends`);
    if (action === 'graphql')
      return texts.some((t) =>
        /\b(close[A-Z]\w*|delete[A-Z]\w*|\w+(Delete|Destroy)|CLOSED?)\b|\bforce\s*:\s*true\b/.test(
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
  try {
    return new Checker(real).run(command, realDir(ctx.cwd));
  } catch (err) {
    if (err instanceof Unparsable)
      return unresolvable(`how the shell splits this command (${err.message})`);
    throw err;
  }
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
