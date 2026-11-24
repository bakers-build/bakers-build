import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { watchForRestart } from '../../src/core/self-restart.js';

const DEBOUNCE = 100;
const settle = (ms = DEBOUNCE * 4) => new Promise((r) => setTimeout(r, ms));

describe('self-restart watcher', () => {
  let dir: string;
  let close: (() => void) | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bakers-self-restart-'));
  });

  afterEach(() => {
    close?.();
    close = undefined;
    rmSync(dir, { recursive: true, force: true });
  });

  function watch(
    paths: { files: string[]; dirs: string[] },
    trigger: (paths: string[]) => Promise<void> = async () => {},
    since?: number,
  ): string[][] {
    const fired: string[][] = [];
    const watcher = watchForRestart(
      paths,
      async (changed) => {
        fired.push(changed);
        await trigger(changed);
      },
      DEBOUNCE,
      since,
    );
    close = () => watcher.close();
    return fired;
  }

  it.skipIf(typeof (process as { execve?: unknown }).execve !== 'function')(
    'execve replaces the process in place: same pid, same inherited stdout',
    () => {
      const script = join(dir, 'spike.mjs');
      writeFileSync(
        script,
        `if (process.argv[2] === 'after') console.log('after', process.pid);
else { console.log('before', process.pid);
  process.execve(process.execPath, [process.execPath, process.argv[1], 'after'], process.env); }`,
      );
      const out = execFileSync(process.execPath, [script], {
        encoding: 'utf8',
      });
      const [before, after] = out.trim().split('\n');
      expect(before?.split(' ')[0]).toBe('before');
      expect(after?.split(' ')[0]).toBe('after');
      expect(after?.split(' ')[1]).toBe(before?.split(' ')[1]);
    },
  );

  it('fires once for a write to a watched file, and once for a rename-replace save', async () => {
    const file = join(dir, 'project.config.js');
    writeFileSync(file, 'export default {};');
    const fired = watch({ files: [file], dirs: [] });

    writeFileSync(file, 'export default { a: 1 };');
    await settle();
    expect(fired).toEqual([[file]]);

    writeFileSync(join(dir, '.project.config.js.swp'), 'x');
    renameSync(join(dir, '.project.config.js.swp'), file);
    await settle();
    expect(fired).toEqual([[file], [file]]);
  });

  it('ignores an unrelated file next to a watched one', async () => {
    const file = join(dir, 'project.config.js');
    writeFileSync(file, 'export default {};');
    const fired = watch({ files: [file], dirs: [] });

    writeFileSync(join(dir, 'log.txt'), 'noise');
    await settle();
    expect(fired).toEqual([]);
  });

  it('fires when a not-yet-existing watched file is created', async () => {
    const local = join(dir, 'machine.config.js');
    const fired = watch({ files: [local], dirs: [] });

    writeFileSync(local, 'export default {};');
    await settle();
    expect(fired).toEqual([[local]]);
  });

  it('fires for a write deep inside a watched addon directory', async () => {
    const dist = join(dir, 'addon', 'dist');
    mkdirSync(join(dist, 'nested'), { recursive: true });
    const fired = watch({ files: [], dirs: [dist] });

    writeFileSync(join(dist, 'nested', 'index.js'), 'export {};');
    await settle();
    expect(fired).toEqual([[join(dist, 'nested', 'index.js')]]);
  });

  it('coalesces several changes in quick succession into one trigger', async () => {
    const file = join(dir, 'project.config.js');
    writeFileSync(file, '');
    const fired = watch({ files: [file], dirs: [] });

    for (const n of [1, 2, 3]) {
      writeFileSync(file, `// ${n}`);
      await settle(DEBOUNCE / 4);
    }
    await settle();
    expect(fired).toHaveLength(1);
  });

  it('reports every watched file changed within one window in one trigger', async () => {
    const config = join(dir, 'project.config.js');
    const secrets = join(dir, '.bakers.env');
    writeFileSync(config, '');
    const fired = watch({ files: [config, secrets], dirs: [] });

    writeFileSync(config, '// 1');
    writeFileSync(secrets, 'A=1');
    writeFileSync(config, '// 2');
    await settle();
    expect(fired).toHaveLength(1);
    expect([...(fired[0] ?? [])].sort()).toEqual([secrets, config].sort());

    writeFileSync(secrets, 'A=2');
    await settle();
    expect(fired[1]).toEqual([secrets]);
  });

  it('never runs two triggers at once; a change during one re-checks after it', async () => {
    const file = join(dir, 'project.config.js');
    writeFileSync(file, '');
    let running = 0;
    let overlap = false;
    let release: () => void = () => {};
    const fired = watch({ files: [file], dirs: [] }, async () => {
      running += 1;
      if (running > 1) overlap = true;
      if (fired.length === 1)
        await new Promise<void>((r) => {
          release = r;
        });
      running -= 1;
    });

    writeFileSync(file, '// 1');
    await settle();
    expect(fired).toHaveLength(1);

    writeFileSync(file, '// 2'); // arrives while the first trigger still runs
    await settle();
    expect(fired).toHaveLength(1);

    release();
    await settle();
    expect(fired).toHaveLength(2);
    expect(overlap).toBe(false);
  });

  it('stops firing after close', async () => {
    const file = join(dir, 'project.config.js');
    writeFileSync(file, '');
    const fired = watch({ files: [file], dirs: [] });
    close?.();
    close = undefined;

    writeFileSync(file, '// changed');
    await settle();
    expect(fired).toEqual([]);
  });
  it('fires once for a watched file written after the config was loaded, before watching began', async () => {
    const old = join(dir, 'project.config.js');
    const machine = join(dir, 'machine.config.js');
    writeFileSync(old, 'export default {};');
    utimesSync(
      old,
      new Date(Date.now() - 60_000),
      new Date(Date.now() - 60_000),
    );
    const loadedAt = Date.now() - 30_000;
    writeFileSync(machine, 'export default { plugins: true };');

    const fired = watch(
      { files: [old, machine], dirs: [] },
      undefined,
      loadedAt,
    );
    await settle();
    expect(fired).toEqual([[machine]]);
  });
  it('counts a write made right after the config was loaded, though the file clock trails Date.now()', async () => {
    const machine = join(dir, 'machine.config.js');
    const loadedAt = Date.now();
    writeFileSync(machine, 'export default { plugins: true };');

    const fired = watch({ files: [machine], dirs: [] }, undefined, loadedAt);
    await settle();
    expect(fired).toEqual([[machine]]);
  });
  it('ignores a watched file with a future mtime, so a clock step back cannot loop restarts', async () => {
    const machine = join(dir, 'machine.config.js');
    writeFileSync(machine, 'export default {};');
    const ahead = new Date(Date.now() + 60_000);
    utimesSync(machine, ahead, ahead);

    const fired = watch({ files: [machine], dirs: [] }, undefined, Date.now());
    await settle();
    expect(fired).toEqual([]);
  });
});
