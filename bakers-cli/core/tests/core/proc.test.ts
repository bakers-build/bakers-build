import { describe, expect, it } from 'vitest';
import {
  type ProcProbe,
  signalVerifiedProcess,
  verifyConductorProcess,
} from '../../src/core/proc.js';

/**
 * A pid is never signalled unverified.
 *
 * `last_pid` is the *last known* pid, not a liveness signal: the process may
 * have exited minutes ago and the number may since have been recycled by an
 * unrelated program — an editor, a database, another agent's shell. Signalling
 * it blind would eventually kill something that merely inherited the number.
 *
 * BB-450 D1: the proof is no longer the process's working directory (that
 * compared a process attribute against a config attribute and only coincided
 * over a herdr spawn). The proof is now process identity: the pid is alive,
 * its command line identifies a bakers-conductor foreground loop, it belongs to
 * the same OS user as the caller, and the record's `host_key` names this
 * machine.
 *
 * Every test here runs behind an injected probe. Nothing in this file may send
 * a real signal or read a real /proc — a test suite that kills processes on the
 * developer's machine is not a test suite.
 */
describe('signalVerifiedProcess', () => {
  const HOST = 'cw-dev-box';
  const CONDUCTOR_CMDLINE =
    'node /usr/local/bin/bakers conductor start --foreground --no-update-check';

  it('signals a live pid whose command line identifies a bakers conductor, owned by this user, on this host', () => {
    const probe = fakeProbe({
      4242: { cmdline: CONDUCTOR_CMDLINE, uid: process.getuid?.() ?? 0 },
    });

    const outcome = signalVerifiedProcess({
      pid: 4242,
      hostKey: HOST,
      thisHostKey: HOST,
      signal: 'SIGTERM',
      probe,
    });

    expect(outcome.ok).toBe(true);
    expect(probe.sent).toEqual([[4242, 'SIGTERM']]);
  });

  it('does NOT signal when there is no pid on record', () => {
    const probe = fakeProbe({
      4242: { cmdline: CONDUCTOR_CMDLINE, uid: process.getuid?.() ?? 0 },
    });

    const outcome = signalVerifiedProcess({
      pid: undefined,
      hostKey: HOST,
      thisHostKey: HOST,
      signal: 'SIGTERM',
      probe,
    });

    expect(outcome.ok).toBe(false);
    expect(probe.sent).toEqual([]);
    if (!outcome.ok) {
      expect(outcome.reason).toBe('no-pid');
      expect(outcome.message).toContain('started in a way that records one');
    }
  });

  it("does NOT signal a conductor whose host_key is not this machine's, before any signal is attempted", () => {
    const probe = fakeProbe({
      4242: { cmdline: CONDUCTOR_CMDLINE, uid: process.getuid?.() ?? 0 },
    });

    const outcome = signalVerifiedProcess({
      pid: 4242,
      hostKey: 'someone-elses-box',
      thisHostKey: HOST,
      signal: 'SIGTERM',
      probe,
    });

    expect(outcome.ok).toBe(false);
    expect(probe.sent).toEqual([]);
    if (!outcome.ok) {
      expect(outcome.reason).toBe('host-mismatch');
      expect(outcome.message).toContain('someone-elses-box');
      expect(outcome.message).toContain(HOST);
    }
  });

  it('refuses a record with no host_key at all — never a free pass', () => {
    const probe = fakeProbe({
      4242: { cmdline: CONDUCTOR_CMDLINE, uid: process.getuid?.() ?? 0 },
    });

    const outcome = signalVerifiedProcess({
      pid: 4242,
      hostKey: undefined,
      thisHostKey: HOST,
      signal: 'SIGTERM',
      probe,
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('host-mismatch');
  });

  it('does NOT signal when the process is simply gone', () => {
    const probe = fakeProbe({});

    const outcome = signalVerifiedProcess({
      pid: 4242,
      hostKey: HOST,
      thisHostKey: HOST,
      signal: 'SIGTERM',
      probe,
    });

    expect(outcome.ok).toBe(false);
    expect(probe.sent).toEqual([]);
    if (!outcome.ok) expect(outcome.reason).toBe('stale-pid');
  });

  it('does NOT signal a live pid whose command line is not a bakers conductor', () => {
    const probe = fakeProbe({
      4242: {
        cmdline: '/usr/bin/some-unrelated-daemon',
        uid: process.getuid?.() ?? 0,
      },
    });

    const outcome = signalVerifiedProcess({
      pid: 4242,
      hostKey: HOST,
      thisHostKey: HOST,
      signal: 'SIGTERM',
      probe,
    });

    expect(outcome.ok).toBe(false);
    expect(probe.sent).toEqual([]);
    if (!outcome.ok) {
      expect(outcome.reason).toBe('stale-pid');
      expect(outcome.message).toContain('recycled');
    }
  });

  it('does NOT signal a live conductor-shaped pid owned by another user', () => {
    const probe = fakeProbe({
      4242: {
        cmdline: CONDUCTOR_CMDLINE,
        uid: (process.getuid?.() ?? 0) + 1,
      },
    });

    const outcome = signalVerifiedProcess({
      pid: 4242,
      hostKey: HOST,
      thisHostKey: HOST,
      signal: 'SIGTERM',
      probe,
    });

    expect(outcome.ok).toBe(false);
    expect(probe.sent).toEqual([]);
    if (!outcome.ok) {
      expect(outcome.reason).toBe('stale-pid');
      expect(outcome.message).toContain('does not belong to this user');
    }
  });

  it('degrades with a clear message where process identity cannot be read at all', () => {
    const probe = fakeProbe(
      { 4242: { cmdline: CONDUCTOR_CMDLINE, uid: process.getuid?.() ?? 0 } },
      { supported: false },
    );

    const outcome = signalVerifiedProcess({
      pid: 4242,
      hostKey: HOST,
      thisHostKey: HOST,
      signal: 'SIGTERM',
      probe,
    });

    expect(outcome.ok).toBe(false);
    expect(probe.sent).toEqual([]);
    if (!outcome.ok) {
      expect(outcome.reason).toBe('unverifiable-platform');
      expect(outcome.message.toLowerCase()).toContain('verify');
    }
  });

  it('carries a failing signal back instead of throwing', () => {
    const probe = fakeProbe({
      4242: { cmdline: CONDUCTOR_CMDLINE, uid: process.getuid?.() ?? 0 },
    });
    probe.throwOnSend = new Error('EPERM: operation not permitted');

    const outcome = signalVerifiedProcess({
      pid: 4242,
      hostKey: HOST,
      thisHostKey: HOST,
      signal: 'SIGTERM',
      probe,
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe('signal-failed');
      expect(outcome.message).toContain('EPERM');
    }
  });

  it('sends whatever signal it is given, so a hard kill uses the same gate', () => {
    const probe = fakeProbe({
      4242: { cmdline: CONDUCTOR_CMDLINE, uid: process.getuid?.() ?? 0 },
    });

    const outcome = signalVerifiedProcess({
      pid: 4242,
      hostKey: HOST,
      thisHostKey: HOST,
      signal: 'SIGKILL',
      probe,
    });

    expect(outcome.ok).toBe(true);
    expect(probe.sent).toEqual([[4242, 'SIGKILL']]);
  });
});

/**
 * R13 (BB-473): `verifyConductorProcess` is the pre-signal half extracted
 * out of `signalVerifiedProcess` — same proof, no `probe.send` call. Proven
 * here as a read-only, no-signal check: it never touches `probe.send`
 * (`fakeProbe.sent` stays empty throughout), and its outcome mirrors
 * `signalVerifiedProcess`'s `reason` for every branch.
 */
describe('verifyConductorProcess', () => {
  const HOST = 'cw-dev-box';
  const CONDUCTOR_CMDLINE =
    'node /usr/local/bin/bakers conductor start --foreground --no-update-check';

  it('never calls probe.send — it is read-only', () => {
    const probe = fakeProbe({
      4242: { cmdline: CONDUCTOR_CMDLINE, uid: process.getuid?.() ?? 0 },
    });

    const result = verifyConductorProcess({
      pid: 4242,
      hostKey: HOST,
      thisHostKey: HOST,
      probe,
    });

    expect(result).toEqual({ ok: true, pid: 4242 });
    expect(probe.sent).toEqual([]);
  });

  it('reports no-pid', () => {
    const probe = fakeProbe({});
    const outcome = verifyConductorProcess({
      pid: undefined,
      hostKey: HOST,
      thisHostKey: HOST,
      probe,
    });
    if (!outcome.ok) expect(outcome.reason).toBe('no-pid');
    else expect.fail('expected no-pid');
  });

  it('reports host-mismatch without ever probing the pid', () => {
    const probe = fakeProbe({
      4242: { cmdline: CONDUCTOR_CMDLINE, uid: process.getuid?.() ?? 0 },
    });
    const outcome = verifyConductorProcess({
      pid: 4242,
      hostKey: 'other-host',
      thisHostKey: HOST,
      probe,
    });
    if (!outcome.ok) expect(outcome.reason).toBe('host-mismatch');
    else expect.fail('expected host-mismatch');
  });

  it('reports unverifiable-platform', () => {
    const probe = fakeProbe({}, { supported: false });
    const outcome = verifyConductorProcess({
      pid: 4242,
      hostKey: HOST,
      thisHostKey: HOST,
      probe,
    });
    if (!outcome.ok) expect(outcome.reason).toBe('unverifiable-platform');
    else expect.fail('expected unverifiable-platform');
  });

  it('reports stale-pid for a dead pid', () => {
    const probe = fakeProbe({});
    const outcome = verifyConductorProcess({
      pid: 9999,
      hostKey: HOST,
      thisHostKey: HOST,
      probe,
    });
    if (!outcome.ok) expect(outcome.reason).toBe('stale-pid');
    else expect.fail('expected stale-pid');
  });

  it('reports stale-pid for a recycled pid running something else', () => {
    const probe = fakeProbe({
      4242: {
        cmdline: '/usr/bin/some-other-program',
        uid: process.getuid?.() ?? 0,
      },
    });
    const outcome = verifyConductorProcess({
      pid: 4242,
      hostKey: HOST,
      thisHostKey: HOST,
      probe,
    });
    if (!outcome.ok) expect(outcome.reason).toBe('stale-pid');
    else expect.fail('expected stale-pid');
  });

  it("reports stale-pid when the pid belongs to a different user's process", () => {
    const probe = fakeProbe({
      4242: { cmdline: CONDUCTOR_CMDLINE, uid: (process.getuid?.() ?? 0) + 1 },
    });
    const outcome = verifyConductorProcess({
      pid: 4242,
      hostKey: HOST,
      thisHostKey: HOST,
      probe,
    });
    if (!outcome.ok) expect(outcome.reason).toBe('stale-pid');
    else expect.fail('expected stale-pid');
  });
});

interface FakeProbe extends ProcProbe {
  sent: Array<[number, string]>;
  throwOnSend?: Error;
}

function fakeProbe(
  procs: Record<number, { cmdline: string; uid: number }>,
  opts: { supported?: boolean } = {},
): FakeProbe {
  return {
    supported: opts.supported ?? true,
    sent: [],
    cmdlineOf(pid: number) {
      return procs[pid]?.cmdline;
    },
    uidOf(pid: number) {
      return procs[pid]?.uid;
    },
    send(pid: number, signal: NodeJS.Signals) {
      if (this.throwOnSend) throw this.throwOnSend;
      (this as FakeProbe).sent.push([pid, signal]);
    },
  } as FakeProbe;
}
