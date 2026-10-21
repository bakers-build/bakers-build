import { describe, expect, it, vi } from 'vitest';
import {
  createConductorProcessHost,
  defaultSpawn,
} from '../../../src/Entity/conductor/Data/process.js';

/**
 * Starting and stopping a conductor from the cockpit.
 *
 * Both halves run through an injected seam, so nothing here spawns a real
 * process or signals a real pid — a suite that did would kill the developer's
 * own conductors.
 */
describe('conductor process host', () => {
  const WORKSPACE = '/home/dev/bakers/.bakers';
  const HOST_KEY = 'cw-framework';

  const host = (over: Parameters<typeof createConductorProcessHost>[0] = {}) =>
    createConductorProcessHost({
      spawn: vi.fn(),
      signal: vi.fn(() => ({ ok: true as const, pid: 1, signal: 'SIGTERM' })),
      // Never the real ~/.bakers/machine.config.js — a unit test must not read
      // the developer's actual machine identity.
      thisHostKey: async () => HOST_KEY,
      ...over,
    });

  describe('start', () => {
    it('runs `bakers conductor start` in the conductor’s own workspace', async () => {
      const spawn = vi.fn();
      const h = host({ spawn });

      await h.start({
        workspaceRoot: WORKSPACE,
        conductorName: 'conductor',
        hostKey: HOST_KEY,
      });

      expect(spawn).toHaveBeenCalledOnce();
      const call = spawn.mock.calls[0]?.[0];
      expect(call.command).toBe('bakers');
      expect(call.args).toEqual(['conductor', 'start']);
      expect(call.cwd).toBe(WORKSPACE);
    });

    it('targets the conductor BY NAME, not by rebuilding its config path', async () => {
      const spawn = vi.fn();
      const h = host({ spawn });

      await h.start({
        workspaceRoot: WORKSPACE,
        conductorName: 'shop',
        hostKey: HOST_KEY,
      });

      expect(spawn.mock.calls[0]?.[0].env.BB_CONDUCTOR).toBe('shop');
    });

    it('CLEARS an inherited $BB_CONDUCTOR_CONFIG in the child', async () => {
      // It beats $BB_CONDUCTOR in core's resolution, so a value inherited from
      // the shell that started `bakers ui` would silently target another config —
      // the one failure mode of this whole screen that produces no error at all.
      const spawn = vi.fn();
      const h = host({ spawn });

      await h.start({
        workspaceRoot: WORKSPACE,
        conductorName: 'shop',
        hostKey: HOST_KEY,
      });

      expect(spawn.mock.calls[0]?.[0].env.BB_CONDUCTOR_CONFIG).toBe('');
    });

    it('omits the name when the conductor never reported one', async () => {
      const spawn = vi.fn();
      const h = host({ spawn });

      await h.start({
        workspaceRoot: WORKSPACE,
        conductorName: undefined,
        hostKey: HOST_KEY,
      });

      expect(spawn.mock.calls[0]?.[0].env.BB_CONDUCTOR).toBeUndefined();
    });

    it('reports a synchronously thrown spawn failure instead of throwing into the TUI', async () => {
      const h = host({
        spawn: vi.fn(() => {
          throw new Error('spawn refused before the fork');
        }),
      });

      const out = await h.start({
        workspaceRoot: WORKSPACE,
        conductorName: 'conductor',
        hostKey: HOST_KEY,
      });

      expect(out.ok).toBe(false);
      expect(out.message).toContain('spawn refused before the fork');
    });

    // BB-232 review finding F2. The case above is NOT the one that happens:
    // `child_process.spawn` reports ENOENT/EACCES on an `'error'` EVENT, one
    // tick later, and a synchronous `try/catch` cannot see it. The seam is
    // therefore awaited, so an async failure is reportable at all.
    it('reports an ASYNCHRONOUS spawn failure — the case that really occurs', async () => {
      const h = host({
        spawn: vi.fn(
          () =>
            new Promise<void>((_resolve, reject) => {
              setTimeout(() => reject(new Error('spawn bakers ENOENT')), 0);
            }),
        ),
      });

      const out = await h.start({
        workspaceRoot: WORKSPACE,
        conductorName: 'conductor',
        hostKey: HOST_KEY,
      });

      expect(out.ok).toBe(false);
      expect(out.message).toContain('ENOENT');
    });

    it('claims success only once the child has really spawned', async () => {
      // The old message was written before the fork had happened, so the row
      // said "starting …" for a conductor that never started.
      let settle: (() => void) | undefined;
      const h = host({
        spawn: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              settle = resolve;
            }),
        ),
      });

      let done = false;
      const pending = h
        .start({
          workspaceRoot: WORKSPACE,
          conductorName: 'shop',
          hostKey: HOST_KEY,
        })
        .then((r) => {
          done = true;
          return r;
        });
      await Promise.resolve();
      expect(done).toBe(false);

      settle?.();
      const out = await pending;
      expect(out.ok).toBe(true);
      expect(out.message).toContain('shop');
    });

    // BB-450 review B5: before this, `start` received no identity at all —
    // `workspaceRoot` and `conductorName` alone — so a row naming ANOTHER
    // machine's conductor whose workspace path happened to also exist on this
    // disk (the ordinary case for one operator with several machines) started
    // THIS machine's conductor instead, silently. `stop` never had this hole:
    // it already runs the row's `hostKey` through `signalVerifiedProcess`.
    it("refuses to start a conductor whose host_key is not this machine's, and never spawns", async () => {
      const spawn = vi.fn();
      const h = host({ spawn });

      const out = await h.start({
        workspaceRoot: WORKSPACE,
        conductorName: 'conductor',
        hostKey: 'someone-elses-box',
      });

      expect(out.ok).toBe(false);
      expect(out.message).toContain('host_key');
      expect(spawn).not.toHaveBeenCalled();
    });

    it('refuses to start when the row carries no host_key at all', async () => {
      const spawn = vi.fn();
      const h = host({ spawn });

      const out = await h.start({
        workspaceRoot: WORKSPACE,
        conductorName: 'conductor',
        hostKey: undefined,
      });

      expect(out.ok).toBe(false);
      expect(spawn).not.toHaveBeenCalled();
    });

    // BB-477 FV-5: `spawn` settling only proves the fork happened. When the
    // caller can observe the outcome (an `id` and `client` are supplied), a
    // failed start must be reported where the operator acted, not read back
    // as a successful spawn.
    describe('watching for a fresh heartbeat (BB-477 AC-5)', () => {
      const fakeClient = {} as never;

      it('reports success once a heartbeat newer than the prior one arrives', async () => {
        const fetchLastSeen = vi
          .fn()
          .mockResolvedValueOnce(100) // stale — same as priorLastSeen
          .mockResolvedValueOnce(200); // fresh
        const h = host({ fetchLastSeen, sleep: vi.fn(async () => {}) });

        const out = await h.start({
          workspaceRoot: WORKSPACE,
          conductorName: 'anerkennungsportal',
          hostKey: HOST_KEY,
          id: 'conductor-uuid',
          priorLastSeen: 100,
          client: fakeClient,
        });

        expect(out.ok).toBe(true);
        expect(out.message).toContain('anerkennungsportal');
        expect(fetchLastSeen).toHaveBeenCalledTimes(2);
      });

      it('reports the conductor did not come online when no fresh heartbeat arrives within budget', async () => {
        const fetchLastSeen = vi.fn().mockResolvedValue(100); // never newer
        const sleep = vi.fn(async () => {});
        const h = host({
          fetchLastSeen,
          sleep,
          heartbeatPollAttempts: 3,
          heartbeatPollIntervalMs: 10,
        });

        const out = await h.start({
          workspaceRoot: WORKSPACE,
          conductorName: 'anerkennungsportal',
          hostKey: HOST_KEY,
          id: 'conductor-uuid',
          priorLastSeen: 100,
          client: fakeClient,
        });

        expect(out.ok).toBe(false);
        expect(out.message).toContain('anerkennungsportal');
        expect(out.message).toContain('did not come online');
        expect(fetchLastSeen).toHaveBeenCalledTimes(3);
        expect(sleep).toHaveBeenCalledWith(10);
      });

      it('does not poll at all when the caller supplies no id/client — start behaves as before', async () => {
        const fetchLastSeen = vi.fn();
        const h = host({ fetchLastSeen });

        const out = await h.start({
          workspaceRoot: WORKSPACE,
          conductorName: 'conductor',
          hostKey: HOST_KEY,
        });

        expect(out.ok).toBe(true);
        expect(fetchLastSeen).not.toHaveBeenCalled();
      });
    });
  });

  // F2, at the seam the injected fakes above stand in for. This is the only
  // place the REAL `child_process.spawn` runs, and it runs against a binary
  // that cannot exist — so no conductor is started. Before the fix the missing
  // `'error'` listener made Node's EventEmitter THROW on that event, taking
  // `bakers ui` down with it; the assertion below is a rejection precisely
  // because the listener now exists.
  describe('defaultSpawn — the real child', () => {
    const NOT_A_BINARY = 'bakers-not-a-real-binary-4f3a9c';

    it('rejects on ENOENT rather than crashing the process', async () => {
      await expect(
        defaultSpawn({
          command: NOT_A_BINARY,
          args: [],
          cwd: process.cwd(),
          env: process.env,
        }),
      ).rejects.toThrow(/ENOENT/);
    });

    it('resolves once a real child has spawned, and disowns it', async () => {
      // `node -e ''` exits immediately and inherits nothing: the cheapest real
      // process that proves the `'spawn'` half of the contract.
      await expect(
        defaultSpawn({
          command: process.execPath,
          args: ['-e', ''],
          cwd: process.cwd(),
          env: process.env,
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('stop', () => {
    it("signals the verified pid, resolving this machine's host_key itself", async () => {
      const signal = vi.fn(() => ({
        ok: true as const,
        pid: 4242,
        signal: 'SIGTERM' as NodeJS.Signals,
      }));
      const h = host({ signal });

      const out = await h.stop({ pid: 4242, hostKey: HOST_KEY });

      expect(out.ok).toBe(true);
      expect(signal).toHaveBeenCalledWith({
        pid: 4242,
        hostKey: HOST_KEY,
        thisHostKey: HOST_KEY,
        signal: 'SIGTERM',
      });
    });

    it('carries the verification refusal back to the row verbatim', async () => {
      const h = host({
        signal: vi.fn(() => ({
          ok: false as const,
          reason: 'stale-pid' as const,
          message: 'pid 4242 is running something else, not a bakers conductor',
        })),
      });

      const out = await h.stop({ pid: 4242, hostKey: HOST_KEY });

      expect(out.ok).toBe(false);
      expect(out.message).toContain('not a bakers conductor');
    });

    it('never spawns anything — a stop is a signal', async () => {
      const spawn = vi.fn();
      const h = host({ spawn });

      await h.stop({ pid: 4242, hostKey: HOST_KEY });

      expect(spawn).not.toHaveBeenCalled();
    });
  });
});
