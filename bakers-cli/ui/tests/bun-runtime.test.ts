import { describe, expect, it } from 'vitest';
import {
  applyOpentuiLibc,
  detectLibcFamily,
  shouldReExecUnderBun,
} from '../src/bun-runtime.js';

/** A glibc box: `/proc/self/maps` names the glibc interpreter. */
const GLIBC_MAPS = [
  '55a1b2c00000-55a1b2c21000 r--p 00000000 fe:02 1  /usr/bin/node',
  '7f3c2a000000-7f3c2a02d000 r--p 00000000 fe:02 2  /usr/lib/ld-linux-x86-64.so.2',
  '7f3c29c00000-7f3c29c28000 r--p 00000000 fe:02 3  /usr/lib/libc.so.6',
].join('\n');

/** An Alpine box: the musl interpreter IS libc there. */
const MUSL_MAPS = [
  '55a1b2c00000-55a1b2c21000 r--p 00000000 fe:02 1  /usr/local/bin/node',
  '7f3c2a000000-7f3c2a02d000 r--p 00000000 fe:02 2  /lib/ld-musl-x86_64.so.1',
].join('\n');

const probe = (over: {
  platform?: string;
  maps?: string | undefined;
  report?: 'glibc' | 'musl' | 'unknown';
}) => ({
  platform: over.platform ?? 'linux',
  readProcSelfMaps: () => ('maps' in over ? over.maps : GLIBC_MAPS),
  readReportLibc: () => over.report ?? ('unknown' as const),
});

describe('shouldReExecUnderBun', () => {
  it('re-execs on Node when the cockpit will launch', () => {
    expect(shouldReExecUnderBun({ printConfig: false })).toBe(true);
  });

  it('never re-execs when already under Bun — the loop guard', () => {
    expect(
      shouldReExecUnderBun({ bunVersion: '1.3.14', printConfig: false }),
    ).toBe(false);
  });

  it('never re-execs for --print-config, so the diagnostic survives a broken runtime', () => {
    expect(shouldReExecUnderBun({ printConfig: true })).toBe(false);
  });

  it('honours the documented escape hatch', () => {
    expect(shouldReExecUnderBun({ noBun: '1', printConfig: false })).toBe(
      false,
    );
  });

  it('never re-execs when the caller injected its own renderer', () => {
    // The re-exec exists for ONE reason: the dynamically-resolved
    // `@bakers-build/addon-bakers-ui` reaches OpenTUI's Zig core through FFI. A caller
    // that hands `cmdUi` its own `runUi` never loads that module, so Bun buys it
    // nothing — and every one of the 31 `cmdUi` tests is exactly such a caller.
    // Without this leg the predicate returns true inside vitest and
    // `reExecUnderBun` calls `process.exit()` on the test worker.
    expect(
      shouldReExecUnderBun({ injectedRenderer: true, printConfig: false }),
    ).toBe(false);
  });
});

describe('detectLibcFamily', () => {
  it('reads musl off the interpreter actually mapped into this process', () => {
    expect(detectLibcFamily(probe({ maps: MUSL_MAPS }))).toBe('musl');
  });

  it('reads glibc off the same evidence', () => {
    expect(detectLibcFamily(probe({ maps: GLIBC_MAPS }))).toBe('glibc');
  });

  it('falls back to the report when /proc is not readable', () => {
    // A hardened container can hide /proc. The node report needs no filesystem,
    // and its header omits `glibcVersionRuntime` exactly on musl — measured on
    // node:22-alpine under BOTH node and bun.
    expect(detectLibcFamily(probe({ maps: undefined, report: 'musl' }))).toBe(
      'musl',
    );
    expect(detectLibcFamily(probe({ maps: undefined, report: 'glibc' }))).toBe(
      'glibc',
    );
  });

  it('is inconclusive when neither source answers', () => {
    expect(
      detectLibcFamily(probe({ maps: undefined, report: 'unknown' })),
    ).toBe('unknown');
  });

  it('never probes off Linux — a darwin report has no glibc version either', () => {
    // The report header omits `glibcVersionRuntime` on macOS and Windows too, so
    // reading it as "musl" would mislabel every mac. musl is a Linux question.
    expect(
      detectLibcFamily(probe({ platform: 'darwin', maps: MUSL_MAPS })),
    ).toBe('unknown');
  });
});

describe('applyOpentuiLibc', () => {
  it('sets OPENTUI_LIBC=musl on musl, so no user has to export it', () => {
    // `@opentui/core@0.5.1` picks its platform package from this variable and
    // DEFAULTS TO GLIBC — it runs no probe. Both prebuilts are always on disk,
    // so the wrong one loads and dies with
    // `Error loading shared library ld-linux-x86-64.so.2`.
    const env: NodeJS.ProcessEnv = {};
    applyOpentuiLibc(env, () => 'musl');
    expect(env.OPENTUI_LIBC).toBe('musl');
  });

  it('leaves glibc alone — glibc is the upstream default', () => {
    const env: NodeJS.ProcessEnv = {};
    applyOpentuiLibc(env, () => 'glibc');
    expect(env.OPENTUI_LIBC).toBeUndefined();
  });

  it('changes nothing when detection is inconclusive', () => {
    const env: NodeJS.ProcessEnv = {};
    applyOpentuiLibc(env, () => 'unknown');
    expect(env.OPENTUI_LIBC).toBeUndefined();
  });

  it('never overwrites an explicit value — the operator override wins', () => {
    const env: NodeJS.ProcessEnv = { OPENTUI_LIBC: 'glibc' };
    applyOpentuiLibc(env, () => 'musl');
    expect(env.OPENTUI_LIBC).toBe('glibc');
  });

  it('does not probe at all when the caller already set the variable', () => {
    // The Bun child inherits the parent's env, so this is the leg that keeps the
    // re-exec from paying for the same probe twice.
    let probed = 0;
    applyOpentuiLibc({ OPENTUI_LIBC: 'musl' }, () => {
      probed += 1;
      return 'musl';
    });
    expect(probed).toBe(0);
  });

  it('treats an empty value as unset', () => {
    const env: NodeJS.ProcessEnv = { OPENTUI_LIBC: '' };
    applyOpentuiLibc(env, () => 'musl');
    expect(env.OPENTUI_LIBC).toBe('musl');
  });
});
