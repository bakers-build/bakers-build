#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';

const root = realpathSync(process.cwd());
const namePattern = /^[a-z][a-z0-9-]{0,50}[a-z0-9]$|^[a-z]$/;
function checkPath(path, directory = false) {
  const info = lstatSync(path, { throwIfNoEntry: false });
  if (
    info &&
    (info.isSymbolicLink() ||
      (directory ? !info.isDirectory() : !info.isFile()))
  ) {
    throw new Error(
      `Refusing non-${directory ? 'directory' : 'file'} output: ${path}`,
    );
  }
  return info;
}
function read(path) {
  return checkPath(path) ? readFileSync(path, 'utf8') : '';
}
function validName(value) {
  if (!namePattern.test(value))
    throw new Error(
      'Invalid DDEV identity; use a lowercase DNS name of at most 52 characters.',
    );
  return value;
}
function yamlName(text) {
  if (
    /^(?:[ \t]+name[ \t]*:|["']name["'][ \t]*:|name[ \t]+:|<<[ \t]*:|\{|\[)/m.test(
      text,
    )
  ) {
    throw new Error(
      'Unsupported DDEV name syntax; use a plain top-level name: value assignment.',
    );
  }
  const values = [...text.matchAll(/^name:[ \t]*(.*)\r?$/gm)].map((m) =>
    validName(m[1].trim()),
  );
  if (new Set(values).size > 1)
    throw new Error('Conflicting DDEV names in config.');
  return values[0];
}
function atomicWrite(path, content) {
  const info = checkPath(path);
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, content, {
      flag: 'wx',
      mode: info ? info.mode & 0o600 : 0o600,
    });
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
}
function setup() {
  checkPath('.ddev', true);
  const overlay = read('.ddev/config.worktree.yaml');
  const env = read('.env.ddev');
  const names = [];
  // Consume whole quoted assignments so key-like lines inside unrelated multiline values survive.
  const assignments =
    /^[ \t]*(?:export[ \t]+)?([A-Za-z_]\w*)[ \t]*=[ \t]*("(?:\\[\s\S]|[^"\\])*"|'[^']*'|(?![ \t]*["'])[^\r\n]*)(?:[ \t]*(?:#[^\r\n]*)?)?(?:\r?\n|$)/gm;
  if (
    /^[ \t]*(?:export[ \t]+)?[A-Za-z_]\w*[ \t]*=[ \t]*["']/m.test(
      env.replace(assignments, ''),
    )
  ) {
    throw new Error('Unterminated quoted value in .env.ddev');
  }
  const remainder = env.replace(assignments, (line, key, value) => {
    if (key === 'DDEV_WORKTREE_NAME') {
      names.push(validName(value));
      return '';
    }
    if (key === 'PLAYWRIGHT_BASE_URL') {
      if (!/^https?:\/\/[^\s'"`$]+$/.test(value))
        throw new Error('Invalid PLAYWRIGHT_BASE_URL in .env.ddev.');
      return '';
    }
    return line;
  });
  if (
    /^[ \t]*(?:export[ \t]+)?(?:DDEV_WORKTREE_NAME|PLAYWRIGHT_BASE_URL)\b/m.test(
      env.replace(assignments, ''),
    )
  ) {
    throw new Error('Unsupported selected assignment in .env.ddev.');
  }
  const configured = yamlName(overlay);
  if (configured) names.push(configured);
  if (new Set(names).size > 1)
    throw new Error(
      'Conflicting local DDEV identities; reconcile .env.ddev and .ddev/config.worktree.yaml before retrying.',
    );
  let name = names[0];
  if (!name) {
    const base = yamlName(readFileSync('.ddev/config.yaml', 'utf8'));
    if (!base) throw new Error('Missing DDEV name in .ddev/config.yaml');
    const git = (...args) =>
      execFileSync('git', args, { encoding: 'utf8' }).trim();
    // An isolated run's workspace has no Git: the conductor names its branch.
    const isolated = process.env.BAKERS_RUNTIME_ISOLATES === '1';
    const linked =
      isolated ||
      resolve(git('rev-parse', '--git-dir')) !==
        resolve(git('rev-parse', '--git-common-dir'));
    if (linked) {
      const branch = (
        isolated
          ? (process.env.BAKERS_BRANCH_NAME ?? '')
          : git('branch', '--show-current')
      )
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-');
      const prefix = `${base}-${branch || 'wt'}`
        .slice(0, 43)
        .replace(/-+$/, '');
      name = `${prefix}-${createHash('sha256').update(root).digest('hex').slice(0, 8)}`;
    } else name = base;
  }
  validName(name);
  const append = (text, value) =>
    `${text}${text && !text.endsWith('\n') ? '\n' : ''}${value}`;
  const nextOverlay = append(
    overlay.replace(/^name:[^\r\n]*(?:\r?\n|$)/gm, ''),
    `name: ${name}\n`,
  );
  const nextEnv = append(
    remainder,
    `DDEV_WORKTREE_NAME=${name}\nPLAYWRIGHT_BASE_URL=https://${name}.ddev.site\n`,
  );
  // Identity first: interruption before the env write is repaired by reusing this overlay.
  atomicWrite('.ddev/config.worktree.yaml', nextOverlay);
  atomicWrite('.env.ddev', nextEnv);
}
const lock = '.ddev/.setup-worktree.lock';
const owner = `${process.pid}-${randomUUID()}`;
let locked = false;
let candidate;
function releaseOwner(token) {
  try {
    // Only the contender that removes this exact owner's marker may remove the directory.
    unlinkSync(`${lock}/${token}`);
    rmdirSync(lock);
  } catch (error) {
    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
  }
}
const release = () => {
  if (locked) {
    releaseOwner(owner);
    locked = false;
  }
};
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    release();
    process.exit(1);
  });
try {
  checkPath('.ddev', true);
  candidate = mkdtempSync('.ddev/.setup-worktree-pending-');
  writeFileSync(`${candidate}/${owner}`, '', { mode: 0o600 });
  for (let attempt = 0; !locked; attempt++) {
    try {
      renameSync(candidate, lock);
      locked = true;
    } catch (error) {
      if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
      checkPath(lock, true);
      let entries;
      try {
        entries = readdirSync(lock);
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }
      for (const token of entries) {
        if (!/^[1-9][0-9]*-[a-f0-9-]+$/.test(token))
          throw new Error(
            'Unrecognized setup lock; inspect .ddev/.setup-worktree.lock before retrying.',
          );
        try {
          process.kill(Number(token.split('-')[0]), 0);
        } catch (error) {
          if (error.code === 'ESRCH') releaseOwner(token);
          else if (error.code !== 'EPERM') throw error;
        }
      }
      if (attempt === 100)
        throw new Error(
          'Another setup process holds .ddev/.setup-worktree.lock; retry after it finishes.',
        );
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  setup();
} catch (error) {
  console.error(`setup-worktree: ${error.message}`);
  process.exitCode = 1;
} finally {
  release();
  if (candidate) rmSync(candidate, { recursive: true, force: true });
}
