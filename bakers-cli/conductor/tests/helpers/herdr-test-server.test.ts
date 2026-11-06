/**
 * AC-5 (BB-229) — the child-environment scrub is the one part of the isolated
 * herdr test server that is pure, so it is the one part that gets a real unit
 * test and runs in CI (default vitest config includes `conductor/tests/**`, it
 * excludes only `conductor/tests/integration/**`).
 *
 * The property under test is the whole safety argument of BB-229: no herdr
 * invocation of the integration suites may inherit an ambient `HERDR_*` value
 * and thereby reach the developer's daemon. The scrub is therefore PREFIX-based
 * (design decision D3) — the `HERDR_FUTURE_VAR` case below is what keeps it
 * honest against a regression to a hand-maintained deny-list.
 */
import { describe, expect, it } from 'vitest';
import { isolatedHerdrEnv, redirectProcessEnv } from './herdr-test-server.js';

const ISOLATED = {
  configHome: '/tmp/bakers-herdr-abc123',
  socketPath: '/tmp/bakers-herdr-abc123/herdr.sock',
};

describe('isolatedHerdrEnv', () => {
  it('drops every inherited HERDR_* value the AC names', () => {
    const parent = {
      HERDR_SOCKET_PATH: '/run/user/1000/herdr.sock',
      HERDR_PANE_ID: 'w1DJ:t1:p1',
      HERDR_WORKSPACE_ID: 'w1DJ',
      HERDR_TAB_ID: 'w1DJ:t1',
      HERDR_SESSION: 'default',
      HERDR_CLIENT_SOCKET_PATH: '/run/user/1000/herdr-client.sock',
      HERDR_ENV: '1',
      HERDR_ACTIVE_PANE_CWD: '/home/cw/projects/bakers',
    };

    const env = isolatedHerdrEnv(parent, ISOLATED);

    // Nothing inherited survives...
    expect(env.HERDR_PANE_ID).toBeUndefined();
    expect(env.HERDR_WORKSPACE_ID).toBeUndefined();
    expect(env.HERDR_TAB_ID).toBeUndefined();
    expect(env.HERDR_SESSION).toBeUndefined();
    expect(env.HERDR_CLIENT_SOCKET_PATH).toBeUndefined();
    expect(env.HERDR_ENV).toBeUndefined();
    expect(env.HERDR_ACTIVE_PANE_CWD).toBeUndefined();
    // ...and the only HERDR_* key left is the isolated socket.
    expect(Object.keys(env).filter((k) => k.startsWith('HERDR_'))).toEqual([
      'HERDR_SOCKET_PATH',
    ]);
  });

  it('sets the isolated socket + config home even when the parent set both', () => {
    const env = isolatedHerdrEnv(
      {
        HERDR_SOCKET_PATH: '/run/user/1000/herdr.sock',
        XDG_CONFIG_HOME: '/home/cw/.config',
      },
      ISOLATED,
    );

    expect(env.HERDR_SOCKET_PATH).toBe(ISOLATED.socketPath);
    expect(env.XDG_CONFIG_HOME).toBe(ISOLATED.configHome);
  });

  it('leaves non-herdr keys untouched', () => {
    const env = isolatedHerdrEnv(
      {
        PATH: '/usr/bin:/bin',
        HOME: '/home/cw',
        FOO: 'bar',
        HERDR_PANE_ID: 'w1:t1:p1',
      },
      ISOLATED,
    );

    expect(env.PATH).toBe('/usr/bin:/bin');
    expect(env.HOME).toBe('/home/cw');
    expect(env.FOO).toBe('bar');
  });

  it('does not mutate the input object', () => {
    const parent = {
      HERDR_PANE_ID: 'w1:t1:p1',
      XDG_CONFIG_HOME: '/home/cw/.config',
    };
    const snapshot = { ...parent };

    isolatedHerdrEnv(parent, ISOLATED);

    expect(parent).toEqual(snapshot);
  });

  it('drops undefined values so nothing is handed to spawn as "undefined"', () => {
    const env = isolatedHerdrEnv(
      { PATH: '/usr/bin', SOME_UNSET: undefined },
      ISOLATED,
    );

    expect('SOME_UNSET' in env).toBe(false);
  });

  it('drops a HERDR_* var it has never heard of (D3: prefix, not deny-list)', () => {
    // The installed binary already carries 18+ HERDR_* vars and adds more over
    // time. A deny-list would silently leak the next one back into the dev
    // daemon — exactly the defect BB-229 removes. This case fails the moment
    // someone rewrites the scrub as a list of known names.
    const env = isolatedHerdrEnv(
      { HERDR_FUTURE_VAR: 'leaks-to-the-dev-daemon' },
      ISOLATED,
    );

    expect(env.HERDR_FUTURE_VAR).toBeUndefined();
  });
});

describe('redirectProcessEnv', () => {
  it('drops every ambient HERDR_* key and points the socket at the private daemon', () => {
    const target: NodeJS.ProcessEnv = {
      HERDR_SOCKET_PATH: '/run/user/1000/herdr.sock',
      HERDR_PANE_ID: 'w1DJ:t1:p1',
      HERDR_FUTURE_VAR: 'x',
      PATH: '/usr/bin',
    };

    redirectProcessEnv(target, ISOLATED.socketPath);

    expect(target.HERDR_SOCKET_PATH).toBe(ISOLATED.socketPath);
    expect(target.HERDR_PANE_ID).toBeUndefined();
    expect(target.HERDR_FUTURE_VAR).toBeUndefined();
    expect(target.PATH).toBe('/usr/bin');
  });

  it('leaves XDG_CONFIG_HOME alone — only the spawned server gets the private one', () => {
    // Regression: redirecting XDG_CONFIG_HOME process-wide made a container
    // runtime CLI (which writes under $XDG_CONFIG_HOME) recreate a directory inside the isolated
    // state dir *after* teardown unlinked it, leaving /tmp/bakers-herdr-*
    // residue. The socket alone routes CLI calls to the private daemon, so the
    // process-wide redirect must stay that narrow. `git` would be next.
    const target: NodeJS.ProcessEnv = { XDG_CONFIG_HOME: '/home/cw/.config' };

    redirectProcessEnv(target, ISOLATED.socketPath);

    expect(target.XDG_CONFIG_HOME).toBe('/home/cw/.config');
  });

  it('restores the exact prior environment, re-deleting keys that did not exist', () => {
    const target: NodeJS.ProcessEnv = {
      HERDR_SOCKET_PATH: '/run/user/1000/herdr.sock',
      HERDR_PANE_ID: 'w1DJ:t1:p1',
      PATH: '/usr/bin',
    };
    const snapshot = { ...target };

    const restore = redirectProcessEnv(target, ISOLATED.socketPath);
    restore();

    expect(target).toEqual(snapshot);
  });

  it('re-deletes HERDR_SOCKET_PATH when the parent never had one', () => {
    const target: NodeJS.ProcessEnv = { PATH: '/usr/bin' };

    const restore = redirectProcessEnv(target, ISOLATED.socketPath);
    expect(target.HERDR_SOCKET_PATH).toBe(ISOLATED.socketPath);
    restore();

    expect('HERDR_SOCKET_PATH' in target).toBe(false);
  });
});
