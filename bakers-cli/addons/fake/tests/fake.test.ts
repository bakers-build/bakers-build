import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SpawnRunInput } from '@bakers-build/conductor/contract';
import { describe, expect, it } from 'vitest';
import { FakeExecutor, fakeExecutor } from '../src/index.js';

function input(workspacePath: string): SpawnRunInput {
  return {
    ticket: {
      uuid: 't-1',
      identifier: 'GL-1',
      title: 'T',
      branchName: 'bakers/gl-1-t',
      state: 'coding',
    },
    run: { uuid: 'r-1', id: 1, handler: 'code' },
    workspacePath,
    instructions: null,
  };
}

describe('FakeExecutor', () => {
  it('is non-persistent', () => {
    const plugin = new FakeExecutor({ outcome: 'exited' });
    expect(plugin.id).toBe('fake');
    expect(plugin.capabilities()).toEqual({ persistent: false });
  });

  it('starts and returns a sessionRef equal to branchName', async () => {
    const plugin = new FakeExecutor({ outcome: 'exited' });
    const ws = mkdtempSync(join(tmpdir(), 'bakers-fake-'));
    const session = await plugin.startRun(input(ws));
    // sessionRef is the branchName
    expect(session.sessionRef).toBe('bakers/gl-1-t');
  });

  it('writes a marker file into the workspace when configured', async () => {
    const plugin = new FakeExecutor({
      outcome: 'exited',
      markerFile: 'bakers-run.json',
    });
    const ws = mkdtempSync(join(tmpdir(), 'bakers-fake-'));
    await plugin.startRun(input(ws));
    const marker = join(ws, 'bakers-run.json');
    expect(existsSync(marker)).toBe(true);
    expect(JSON.parse(readFileSync(marker, 'utf8')).run_uuid).toBe('r-1');
  });

  it('rejects marker files that would escape the workspace', async () => {
    const plugin = new FakeExecutor({
      outcome: 'exited',
      markerFile: '../bakers-run.json',
    });
    const ws = mkdtempSync(join(tmpdir(), 'bakers-fake-'));
    await expect(plugin.startRun(input(ws))).rejects.toThrow(
      /inside the workspace/,
    );
  });

  it('stopRun and cleanupRun are no-ops for the fake executor', async () => {
    const plugin = new FakeExecutor({ outcome: 'exited' });
    const ws = mkdtempSync(join(tmpdir(), 'bakers-fake-'));
    const session = await plugin.startRun(input(ws));
    await expect(plugin.stopRun(session.sessionRef)).resolves.toBeUndefined();
    await expect(
      plugin.cleanupRun(session.sessionRef),
    ).resolves.toBeUndefined();
  });

  it('rejects the old markerFile option key, naming its replacement', () => {
    expect(() => fakeExecutor({ markerFile: 'x' } as never)).toThrow(
      'markerFile was renamed: use marker_file',
    );
  });
});
