import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const script = fileURLToPath(
  new URL('../../../../scripts/teardown-test-project.sh', import.meta.url),
);

type Project = { name: string; approot: string; status: string };
type Event = { tool: string; args: string[]; cwd: string };

// Execute the real shell script. Only external command boundaries are replaced:
// DDEV owns databases, git locates the checkout, and node reads user config.
// The fake DDEV deliberately models unnamed delete falling back to the parent.
const fakeTool = `
const fs = require('node:fs');
const path = require('node:path');
const root = process.env.TEARDOWN_TEST_ROOT;
const tool = path.basename(process.argv[1]);
const args = process.argv.slice(2);
fs.appendFileSync(path.join(root, 'events.jsonl'), JSON.stringify({ tool, args, cwd: process.cwd() }) + '\\n');
if (tool === 'git') {
  if (args.join(' ') === 'rev-parse --show-toplevel') console.log(root);
  else if (args.at(-1) !== 'prune') process.exit(1);
} else if (tool === 'node') {
  process.stdout.write('0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30');
} else if (tool === 'bakers') {
  if (args.join(' ') !== 'oven stop --now') process.exit(1);
} else if (tool === 'ddev') {
  const statePath = path.join(root, 'projects.json');
  const projects = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const name = args.slice(1).find(arg => !arg.startsWith('-'));
  if (args[0] === 'describe') {
    const project = name
      ? projects.find(project => project.name === name)
      : projects.find(project => project.approot === process.cwd()) ?? projects[0];
    if (!project) process.exit(1);
    console.log(JSON.stringify({ level: 'info', raw: project }));
  } else if (args[0] === 'delete') {
    const target = name ?? projects[0].name;
    fs.writeFileSync(statePath, JSON.stringify(projects.filter(project => project.name !== target)));
  } else if (args[0] === 'drush' && args[1] === 'php:eval') {
    fs.writeFileSync(path.join(root, 'purge.php'), args[2]);
    console.log('purge boundary reached');
  } else process.exit(1);
} else process.exit(1);
`;

describe('playground teardown ownership', () => {
  let root: string;
  let workspace: string;
  let workspaceName: string;
  let parent: Project;

  function write(path: string, content: string, executable = false) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, { mode: executable ? 0o755 : 0o644 });
  }

  function register(projects: Project[]) {
    write(join(root, 'projects.json'), JSON.stringify([parent, ...projects]));
  }

  function remaining(): string[] {
    return JSON.parse(readFileSync(join(root, 'projects.json'), 'utf8')).map(
      (project: Project) => project.name,
    );
  }

  function events(): Event[] {
    return readFileSync(join(root, 'events.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
  }

  function run(...args: string[]) {
    const result = spawnSync('bash', [script, ...args], {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${join(root, 'bin')}:${process.env.PATH}`,
        TEARDOWN_TEST_ROOT: root,
      },
      encoding: 'utf8',
      timeout: 10_000,
    });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    return result;
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'bakers-teardown-'));
    workspace = join(root, 'workspaces/bakers-playground');
    workspaceName = `bakers-pg-${createHash('sha1').update(workspace).digest('hex').slice(0, 8)}`;
    parent = { name: 'bakers-control', approot: root, status: 'running' };
    for (const tool of ['git', 'ddev', 'node']) {
      write(
        join(root, 'bin', tool),
        `#!${process.execPath}\n${fakeTool}`,
        true,
      );
    }
    write(
      join(root, 'bakers-cli/bin/bakers'),
      `#!${process.execPath}\n${fakeTool}`,
      true,
    );
    write(join(workspace, '.bakers/conductor.config.js'), 'export default {};');
    write(join(`${workspace}.git`, 'HEAD'), 'ref: refs/heads/develop\n');
    write(
      join(workspace, '.ddev/config.worktree.yaml'),
      `name: ${workspaceName}\n`,
    );
    register([]);
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  // A conductor is machine + project + variant: the purge finds this
  // machine by its UUID and its conductor by that key, never by a string id.
  it('purges the conductor keyed by this machine UUID, the project and the default variant', () => {
    run('--keep-clone');
    const php = readFileSync(join(root, 'purge.php'), 'utf8');
    expect(php).toContain(
      "getStorage('bb_machine')->loadByProperties(['uuid' => '0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30'])",
    );
    expect(php).toContain(
      "'machine' => $machine->id(), 'project_id' => $project->id(), 'variant' => 'conductor'",
    );
    expect(php).not.toContain("'conductor_id' =>");
  });

  it('preserves the registered parent when the configured workspace is unregistered', () => {
    run();
    expect(remaining()).toEqual(['bakers-control']);
    expect(events().filter((event) => event.args[0] === 'delete')).toEqual([]);
    expect(existsSync(workspace)).toBe(false);
    expect(existsSync(`${workspace}.git`)).toBe(false);
  });

  it('does not delete a harness name registered at a different application root', () => {
    register([{ name: workspaceName, approot: root, status: 'running' }]);
    run('--keep-clone');
    expect(remaining()).toEqual(['bakers-control', workspaceName]);
  });

  it('does not treat a symlink target as the owned workspace root', () => {
    const elsewhere = join(root, 'another-checkout');
    rmSync(workspace, { recursive: true });
    write(
      join(elsewhere, '.ddev/config.worktree.yaml'),
      `name: ${workspaceName}\n`,
    );
    symlinkSync(elsewhere, workspace, 'dir');
    register([{ name: workspaceName, approot: elsewhere, status: 'running' }]);
    run('--keep-clone');
    expect(remaining()).toEqual(['bakers-control', workspaceName]);
  });

  it('explicitly deletes the owned stopped workspace after stopping its conductor', () => {
    register([{ name: workspaceName, approot: workspace, status: 'stopped' }]);
    run('--keep-clone');
    expect(remaining()).toEqual(['bakers-control']);
    const calls = events();
    const stop = calls.findIndex((event) => event.tool === 'bakers');
    const purge = calls.findIndex((event) => event.args[0] === 'drush');
    const deletion = calls.findIndex((event) => event.args[0] === 'delete');
    expect(stop).toBeGreaterThanOrEqual(0);
    expect(stop).toBeLessThan(purge);
    expect(stop).toBeLessThan(deletion);
    expect(calls[deletion].args).toEqual(['delete', '-Oy', workspaceName]);
    expect(existsSync(workspace)).toBe(true);
    expect(existsSync(`${workspace}.git`)).toBe(true);
  });

  it('reclaims nested branch worktrees and legacy siblings by their registered names', () => {
    const nested = join(workspace, '.bakers-worktrees/feat/docs-ticket');
    const legacy = `${workspace}-worktrees/fix/old-ticket`;
    for (const path of [nested, legacy])
      write(join(path, '.ddev/config.yaml'), 'name: fixture\n');
    register([
      { name: 'bakers-pg-nested', approot: nested, status: 'running' },
      { name: 'bakers-pg-legacy', approot: legacy, status: 'stopped' },
    ]);
    run('--keep-clone');
    expect(remaining()).toEqual(['bakers-control']);
    expect(
      events()
        .filter((event) => event.args[0] === 'delete')
        .map((event) => event.args),
    ).toEqual([
      ['delete', '-Oy', 'bakers-pg-nested'],
      ['delete', '-Oy', 'bakers-pg-legacy'],
    ]);
  });

  it('leaves unrelated registered worktree names alone', () => {
    const worktree = join(workspace, '.bakers-worktrees/ticket');
    write(join(worktree, '.ddev/config.yaml'), 'name: shared-fixture\n');
    register([
      { name: 'shared-fixture', approot: worktree, status: 'running' },
    ]);
    run('--keep-clone');
    expect(remaining()).toEqual(['bakers-control', 'shared-fixture']);
  });

  it('rejects a parent harness project returned for an unregistered worktree', () => {
    const worktree = join(workspace, '.bakers-worktrees/feat/unregistered');
    write(join(worktree, '.ddev/config.yaml'), 'name: fixture\n');
    parent.name = 'bakers-pg-parent';
    register([]);
    run('--keep-clone');
    expect(remaining()).toEqual(['bakers-pg-parent']);
    expect(events().filter((event) => event.args[0] === 'delete')).toEqual([]);
  });
});
