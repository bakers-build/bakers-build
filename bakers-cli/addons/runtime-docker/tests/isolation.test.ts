import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shellQuote } from '@bakers-build/core';
import { expect, it } from 'vitest';
import { dockerRuntime, realExec } from '../src/backend.js';

const image = 'bakers-runtime:0.0.1';
function available() {
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore', timeout: 10_000 });
    execFileSync('docker', ['image', 'inspect', image], {
      stdio: 'ignore',
      timeout: 10_000,
    });
    return true;
  } catch {
    return false;
  }
}

function snapshot(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  const walk = (directory: string) => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) result[path] = `link:${readlinkSync(path)}`;
      else if (stat.isDirectory()) {
        result[path] = `dir:${stat.mode}`;
        walk(path);
      } else
        result[path] =
          `${stat.mode}:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
    }
  };
  walk(root);
  return result;
}

it.skipIf(!available())(
  'isolates real Docker Git and host scripts, then transfers only the ticket commit',
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'bb-docker-isolation-'));
    const main = join(root, 'main');
    const tree = join(root, 'tree');
    const sibling = join(root, 'sibling');
    const cli = join(root, 'cli');
    const common = join(main, '.git');
    const marker = join(tree, 'host-hook-ran');
    const run = { uuid: `isolation-${process.pid}`, id: 1 };
    const git = (cwd: string, ...args: string[]) =>
      execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        env: {
          ...process.env,
          GIT_CONFIG_GLOBAL: '/dev/null',
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_AUTHOR_NAME: 'test',
          GIT_AUTHOR_EMAIL: 'test@example.test',
          GIT_COMMITTER_NAME: 'test',
          GIT_COMMITTER_EMAIL: 'test@example.test',
        },
      }).trim();
    const runtime = dockerRuntime(
      { image },
      {
        exec: realExec,
        env: { HOME: join(root, 'home'), XDG_CACHE_HOME: join(root, 'cache') },
        logger: { debug() {}, info() {}, warn() {}, error() {} },
        cliRoot: cli,
        packageDir: cli,
        version: 'test',
      },
    );
    try {
      mkdirSync(main);
      mkdirSync(cli);
      git(main, 'init', '-q', '-b', 'main');
      mkdirSync(join(main, '.bakers'));
      mkdirSync(join(main, '.ddev'));
      writeFileSync(join(main, '.bakers/host.sh'), 'trusted bakers');
      writeFileSync(join(main, '.ddev/config.yaml'), 'trusted ddev');
      writeFileSync(join(main, 'work.txt'), 'before');
      git(main, 'add', '.');
      git(main, 'commit', '-qm', 'base');
      git(main, 'worktree', 'add', '-qb', 'ticket', tree);
      git(main, 'worktree', 'add', '-qb', 'sibling', sibling);
      const base = git(main, 'rev-parse', 'HEAD');
      const context = await runtime.prepareRun!(run, {});
      const script = `
const fs = require('node:fs'), cp = require('node:child_process'), assert = require('node:assert/strict');
const git = (...args) => cp.execFileSync('git', args, {encoding:'utf8'}).trim();
const deny = fn => assert.throws(fn);
const common = ${JSON.stringify(common)};
assert.equal(fs.existsSync(common + '/config'), true);
deny(() => fs.writeFileSync('.git', 'gitdir: /tmp/attack'));
deny(() => fs.unlinkSync('.git'));
deny(() => fs.renameSync('.git', '.git-moved'));
assert.equal(fs.existsSync(${JSON.stringify(join(sibling, '.git'))}), false);
for (const file of [common + '/config', common + '/refs/heads/main', common + '/refs/heads/sibling', common + '/objects/planted']) {
  deny(() => fs.writeFileSync(file, 'attack'));
  deny(() => fs.unlinkSync(file));
  deny(() => fs.renameSync(file, file + '-moved'));
}
deny(() => cp.execFileSync('git', ['--git-dir=' + common, 'update-ref', 'refs/heads/main', 'HEAD'], {stdio:'pipe'}));
for (const [dir, name] of [['.bakers', 'host.sh'], ['.ddev', 'config.yaml']]) {
  deny(() => fs.writeFileSync(dir + '/' + name, 'attack'));
  deny(() => fs.writeFileSync(dir + '/planted', 'attack'));
  deny(() => fs.unlinkSync(dir + '/' + name));
  deny(() => fs.renameSync(dir + '/' + name, dir + '/moved'));
  deny(() => fs.renameSync(dir, dir + '-moved'));
  deny(() => fs.rmSync(dir, {recursive:true}));
}
assert.equal(fs.readFileSync('.ddev/config.worktree.yaml', 'utf8'), 'host generated');
fs.writeFileSync('work.txt', 'run-local edit');
git('add', 'work.txt');
git('-c', 'user.name=run', '-c', 'user.email=run@example.test', 'commit', '-qm', 'run-local commit');
git('branch', 'local-only');
const commit = git('rev-parse', 'HEAD');
git('update-ref', 'refs/heads/main', commit);
git('update-ref', 'refs/heads/sibling', commit);
assert.ok(git('log', '--oneline', '-1').includes('run-local commit'));
assert.equal(git('diff', '--name-only', 'HEAD^', 'HEAD'), 'work.txt');
fs.mkdirSync('planted-hooks');
fs.writeFileSync('planted-hooks/reference-transaction', '#!/bin/sh\\ntouch ' + ${JSON.stringify(shellQuote(marker))} + '\\n', {mode:0o755});
git('config', 'core.hooksPath', process.cwd() + '/planted-hooks');
console.log(JSON.stringify({commit}));
`;
      const wrapped = await runtime.wrap({
        ...context,
        command: `node -e ${shellQuote(script)}`,
        env: {},
        workspacePath: tree,
        ticketBranch: 'ticket',
        run,
        harness: 'test',
        readPaths: [join(tree, '.bakers'), join(tree, '.ddev')],
      });
      // Provisioning remains host-owned and can update a path protected inside the run.
      writeFileSync(join(tree, '.ddev/config.worktree.yaml'), 'host generated');
      const before = snapshot(common);
      const siblingBefore = snapshot(sibling);
      const output = execFileSync(
        'sh',
        ['-c', wrapped.command.replace("'-it'", "'-i'")],
        {
          env: { ...process.env, ...wrapped.env },
          encoding: 'utf8',
          timeout: 30_000,
        },
      );
      const { commit } = JSON.parse(output.trim());
      expect(snapshot(common)).toEqual(before);
      expect(snapshot(sibling)).toEqual(siblingBefore);
      expect(git(tree, 'rev-parse', 'HEAD')).toBe(base);
      expect(readFileSync(join(tree, 'work.txt'), 'utf8')).toBe(
        'run-local edit',
      );
      expect(readFileSync(join(tree, '.bakers/host.sh'), 'utf8')).toBe(
        'trusted bakers',
      );
      expect(readFileSync(join(tree, '.ddev/config.yaml'), 'utf8')).toBe(
        'trusted ddev',
      );
      await runtime.transferCommit!(run.uuid, commit);
      expect(git(tree, 'rev-parse', 'HEAD')).toBe(commit);
      expect(git(main, 'rev-parse', 'HEAD')).toBe(base);
      expect(git(sibling, 'rev-parse', 'HEAD')).toBe(base);
      expect(
        git(
          main,
          'for-each-ref',
          '--format=%(refname)',
          'refs/heads/local-only',
        ),
      ).toBe('');
      expect(existsSync(marker)).toBe(false);
      expect(readFileSync(join(common, 'config'), 'utf8')).not.toContain(
        'planted-hooks',
      );
      expect(snapshot(sibling)).toEqual(siblingBefore);
    } finally {
      await runtime.cleanup(run);
      rmSync(root, { recursive: true, force: true });
    }
  },
  60_000,
);
