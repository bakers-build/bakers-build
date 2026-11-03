import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type BbUiLauncherOptions,
  type DropshProgram,
  runBbUi,
} from '../src/launcher.js';
import type { TuiAgentService } from '../src/types.js';

// AC-4: the dropsh-tui invocation lives in the renderer launcher. With a faked
// dropsh `buildProgram` (returning a program that records its argv) and a faked
// renderer factory (recording its options), assert `runBbUi`:
//  (a) builds the program from connection.authPlugins + the renderer instance,
//  (b) passes agents/currentUser/ownConductorId/createPrompt/project/cwd
//      into the renderer factory (→ the renderer's services),
//  (c) runs the `--format tui search bb_project …` seed.

const authPlugin = { id: 'session-oauth2' };

function fakeAgents(): TuiAgentService {
  return {
    launch: async () => ({ id: 'a1', group: 'g', label: 'agent' }),
    list: async () => [],
    focus: async () => {},
    hide: async () => {},
    kill: async () => {},
  };
}

/** A launcher run with a faked buildProgram + renderer; returns what was captured. */
async function runWithFakes(over: Partial<BbUiLauncherOptions> = {}) {
  let builtWith: { plugins: unknown[] } | undefined;
  let ranArgv: string[] | undefined;
  let rendererOpts: Record<string, unknown> | undefined;
  const rendererInstance = { id: 'bakers-ticket-renderer' };

  const program: DropshProgram = {
    parseAsync: async (argv) => {
      ranArgv = argv;
    },
  };
  const opts: BbUiLauncherOptions = {
    connection: {
      baseUrl: 'https://bakers.example',
      jsonapiPrefix: '/jsonapi',
      authPlugins: [authPlugin],
    },
    cwd: '/home/dev',
    project: 'bakers',
    agents: fakeAgents(),
    currentUser: 'cw',
    ownConductorId: 'cw-host-bakers',
    createPrompt: 'work this',
    buildProgram: (o) => {
      builtWith = o;
      return program;
    },
    renderer: (o) => {
      rendererOpts = o as Record<string, unknown>;
      return rendererInstance;
    },
    ...over,
  };
  await runBbUi(opts);
  return { builtWith, ranArgv, rendererOpts, rendererInstance };
}

describe('runBbUi (BB-194 AC-4)', () => {
  const savedConfig = process.env.DROPSH_CONFIG;
  const savedProfile = process.env.DROPSH_AUTH_PROFILE;
  beforeEach(() => {
    delete process.env.DROPSH_CONFIG;
    delete process.env.DROPSH_AUTH_PROFILE;
  });
  afterEach(() => {
    if (savedConfig === undefined) delete process.env.DROPSH_CONFIG;
    else process.env.DROPSH_CONFIG = savedConfig;
    if (savedProfile === undefined) delete process.env.DROPSH_AUTH_PROFILE;
    else process.env.DROPSH_AUTH_PROFILE = savedProfile;
  });

  it('builds the program from connection.authPlugins + the renderer instance', async () => {
    const { builtWith, rendererInstance } = await runWithFakes();
    expect(builtWith?.plugins).toEqual([authPlugin, rendererInstance]);
  });

  it('runs the --format tui search bb_project seed', async () => {
    const { ranArgv } = await runWithFakes();
    expect(ranArgv).toEqual([
      '--format',
      'tui',
      'search',
      'bb_project',
      '--bundle',
      'bb_project',
      '--limit',
      '1',
    ]);
  });

  it('injects agents + identity + project + cwd into the renderer', async () => {
    const { rendererOpts } = await runWithFakes();
    expect(rendererOpts).toMatchObject({
      cwd: '/home/dev',
      project: 'bakers',
      currentUser: 'cw',
      ownConductorId: 'cw-host-bakers',
      createPrompt: 'work this',
    });
    expect(rendererOpts?.agents).toBeDefined();
  });

  // BB-391 (AC2), the INVERTED form of what this case used to assert. It used
  // to check that the launcher exported `$DROPSH_AUTH_PROFILE` from the
  // connection's `authProfile`, pinning `session` so dropsh could not fall
  // through to a previously-active `pm` whose owner-gated reads came back empty.
  // With ONE provider marked `default: true` there is no other profile to fall
  // through to, so pinning one is a claim about capability that no longer
  // exists — the launcher must not set the variable at all.
  it('points DROPSH_CONFIG at the home connection and sets NO auth profile', async () => {
    await runWithFakes({
      connection: {
        baseUrl: 'https://bakers.example',
        authPlugins: [authPlugin],
        configPath: '/home/dev/.config/conductor/ui.dropsh.config.js',
      },
    });
    expect(process.env.DROPSH_CONFIG).toBe(
      '/home/dev/.config/conductor/ui.dropsh.config.js',
    );
    expect(process.env.DROPSH_AUTH_PROFILE).toBeUndefined();
  });

  // BB-223 AC-3: the launcher is one hop of the initial-route thread
  // (RunBbUiOptions → BbUiLauncherOptions → the renderer factory). The hop
  // is OPTIONAL: omitting it is the AC-4 dashboard path, so the key must not
  // appear at all rather than appear as `undefined`.
  it('forwards initialRoute into the renderer factory (BB-223, AC-3)', async () => {
    const initialRoute = {
      kind: 'ticket',
      by: 'identifier',
      value: 'BB-223',
      view: 'teaser',
      fromBranch: 'feat/bb-223-bakers-ui-deep-lin',
    } as const;
    const { rendererOpts } = await runWithFakes({ initialRoute });
    expect(rendererOpts?.initialRoute).toEqual(initialRoute);
  });

  it('omits initialRoute entirely when absent (BB-223, AC-4)', async () => {
    const { rendererOpts } = await runWithFakes();
    expect(rendererOpts).toBeDefined();
    expect('initialRoute' in (rendererOpts as object)).toBe(false);
  });

  it('never imports herdr — the agent host is injected (AC-3)', async () => {
    // Structural: a fake agents service (no herdr) drives launch; the launcher
    // only reads the injected `agents`, proving no herdr coupling.
    const { rendererOpts } = await runWithFakes();
    const agents = rendererOpts?.agents as TuiAgentService;
    const a = await agents.launch({
      group: 'g',
      cwd: '/x',
      prompt: 'p',
      env: {},
    });
    expect(a).toEqual({ id: 'a1', group: 'g', label: 'agent' });
  });
});
