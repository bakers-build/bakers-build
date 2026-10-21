import type { ConductorLogger } from '@bakers-build/core';
import { describe, expect, it } from 'vitest';
import { ActionQueue } from '../../src/core/action-queue.js';

function spyLogger() {
  const calls: { level: string; obj: Record<string, unknown>; msg?: string }[] =
    [];
  const mk =
    (level: string) => (obj: Record<string, unknown>, msg?: string) => {
      calls.push({ level, obj, msg });
    };
  const log = {
    debug: mk('debug'),
    info: mk('info'),
    warn: mk('warn'),
    error: mk('error'),
  };
  return { calls, log: log as unknown as ConductorLogger };
}

function gate() {
  let open!: () => void;
  const opened = new Promise<void>((r) => {
    open = r;
  });
  return { opened, open };
}

describe('ActionQueue', () => {
  it('starts an action at once and ignores its key while it is pending', async () => {
    const q = new ActionQueue(spyLogger().log);
    const g = gate();
    let runs = 0;
    const action = {
      key: 'a',
      lane: 't-1',
      run: async () => {
        runs++;
        await g.opened;
      },
    };
    expect(q.enqueue(action)).toBe(true);
    expect(q.enqueue(action)).toBe(false);
    await Promise.resolve();
    expect(runs).toBe(1);
    g.open();
    await q.drain();
    expect(q.enqueue(action)).toBe(true);
    await q.drain();
    expect(runs).toBe(2);
  });

  it('runs one lane in order and different lanes in parallel', async () => {
    const q = new ActionQueue(spyLogger().log);
    const g = gate();
    const seen: string[] = [];
    q.enqueue({
      key: 'a1',
      lane: 'a',
      run: async () => {
        seen.push('a1 start');
        await g.opened;
        seen.push('a1 end');
      },
    });
    q.enqueue({
      key: 'a2',
      lane: 'a',
      run: async () => {
        seen.push('a2');
      },
    });
    q.enqueue({
      key: 'b1',
      lane: 'b',
      run: async () => {
        seen.push('b1');
      },
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toEqual(['a1 start', 'b1']);
    g.open();
    await q.drain();
    expect(seen).toEqual(['a1 start', 'b1', 'a1 end', 'a2']);
  });

  it('logs a throwing action once, never rejects and keeps the lane running', async () => {
    const { log, calls } = spyLogger();
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on('unhandledRejection', onUnhandled);
    const q = new ActionQueue(log);
    let after = false;
    q.enqueue({
      key: 'boom',
      lane: 't-1',
      run: async () => {
        throw new Error('kaput');
      },
    });
    q.enqueue({
      key: 'next',
      lane: 't-1',
      run: async () => {
        after = true;
      },
    });
    await q.drain();
    await new Promise((r) => setTimeout(r, 0));
    process.off('unhandledRejection', onUnhandled);
    const failed = calls.filter((c) => c.level === 'warn');
    expect(failed).toHaveLength(1);
    expect(failed[0]?.msg).toMatch(/^action boom failed after \d+ms$/);
    expect(failed[0]?.obj).toMatchObject({
      action: 'boom',
      err: 'Error: kaput',
    });
    expect(after).toBe(true);
    expect(unhandled).toEqual([]);
  });

  it('drain waits for actions enqueued while draining', async () => {
    const q = new ActionQueue(spyLogger().log);
    let done = false;
    q.enqueue({
      key: 'a',
      lane: 'x',
      run: async () => {
        q.enqueue({
          key: 'b',
          lane: 'y',
          run: async () => {
            done = true;
          },
        });
      },
    });
    await q.drain();
    expect(done).toBe(true);
    expect(q.size).toBe(0);
  });

  it('warns about each action running longer than the limit, not queued ones', async () => {
    const { log, calls } = spyLogger();
    let clock = 1_000;
    const q = new ActionQueue(log, () => clock);
    const g = gate();
    q.enqueue({ key: 'stuck', lane: 't-1', run: () => g.opened });
    q.enqueue({ key: 'behind', lane: 't-1', run: async () => {} });
    q.enqueue({ key: 'quick', lane: 't-2', run: () => g.opened });
    await Promise.resolve();
    clock += 500;
    q.warnOverdue(1_000);
    expect(calls.filter((c) => c.level === 'warn')).toEqual([]);
    clock += 600;
    q.warnOverdue(1_000);
    const warns = calls.filter((c) => c.level === 'warn');
    expect(warns.map((c) => c.msg)).toEqual([
      'action stuck running for 1100ms',
      'action quick running for 1100ms',
    ]);
    expect(warns[0]?.obj).toMatchObject({ action: 'stuck', ms: 1100 });
    g.open();
    await q.drain();
  });
});
