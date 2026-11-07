import {
  type ClaimContext,
  claimServices,
  discoverClaimedServices,
  type RawDiscovery,
  type RawPort,
} from '@bakers-build/addon-ports/core';
import { describe, expect, it } from 'vitest';
import { claimer } from '../src/claimer.js';

// The DDEV claimer through `@bakers-build/addon-ports`' claimer contract,
// as `with.claimers: ['@bakers-build/addon-ddev']` runs it.

const storybookOnly = {
  entries: [{ key: 'storybook', match: 'storybook' }],
  allNode: false,
};

function rawPort(partial: Partial<RawPort>): RawPort {
  return {
    worktree: '/work',
    listening: 'unknown',
    exposed: 'unknown',
    ...partial,
  };
}

function discovery(ports: RawPort[]): RawDiscovery {
  return { ports, diagnostics: [] };
}

function ctx(): ClaimContext {
  return {
    worktree: '/work',
    ticket: 'pynq-42',
    zone: 'preview.example',
    probe: async () => null,
  };
}

const webRow = (virtualHost: string) =>
  rawPort({
    containerId: 'web123',
    containerPort: 443,
    routerPort: 443,
    virtualHost,
    serviceType: 'web',
    containerState: 'running',
    exposed: true,
    listening: true,
  });

describe('the DDEV claimer in claimServices', () => {
  it('runs Storybook before the DDEV claimer, each over what the other left unclaimed', async () => {
    const storybookRow = rawPort({
      hostAddress: '127.0.0.1',
      hostPort: 6006,
      cmdline: 'node storybook dev',
    });
    const result = await claimServices(
      discovery([storybookRow, webRow('admin.pynq.pynq-42.ddev.site')]),
      ctx(),
      storybookOnly,
      [claimer],
    );
    const keys = result.services.map((s) => s.key).sort();
    expect(keys).toEqual(['storybook', 'web']);
    expect(result.unclaimed).toHaveLength(0);
  });

  it('E: a non-Drupal project (no manifest, no drupal* project type) keeps the plain `web` key', async () => {
    const result = await claimServices(
      discovery([webRow('laravel-42.ddev.site')]),
      ctx(),
      storybookOnly,
      [claimer],
    );
    expect(result.services.map((s) => s.key)).toEqual(['web']);
  });

  it('renames a process claim colliding with a DDEV key', async () => {
    const result = await claimServices(
      discovery([
        rawPort({
          hostAddress: '127.0.0.1',
          hostPort: 3000,
          cmdline: 'node web-server.js',
        }),
        webRow('pynq-42.ddev.site'),
      ]),
      ctx(),
      { entries: [{ key: 'web', match: 'web-server' }], allNode: false },
      [claimer],
    );
    const byClaim = Object.fromEntries(
      result.services.map((s) => [s.claim, s.key]),
    );
    expect(byClaim).toEqual({ ddev: 'web', process: 'web-3000' });
  });
});

describe('the DDEV claimer in discoverClaimedServices', () => {
  it('BB-681 review I1: a failed `ddev utility configyaml` read leaves a web-scoped diagnostic, never silently dropping alias evidence', async () => {
    const deps = {
      run: async (cmd: string) => {
        if (cmd === 'ddev') return { stdout: '', ok: false };
        return { stdout: '', ok: true };
      },
      processInfo: async () => null,
      readFile: async () => null,
    };
    const result = await discoverClaimedServices('/work', deps, {
      ticket: 'pynq-42',
      zone: 'preview.example',
      probe: async () => null,
      rules: storybookOnly,
      claimers: [claimer],
    });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ source: 'claimer', keyPrefix: 'web' }),
    );
  });
});
