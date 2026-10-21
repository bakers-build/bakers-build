import { describe, expect, it } from 'vitest';
import {
  type DdevHostsDeps,
  discoverDdevHosts,
  parseDdevHosts,
} from '../src/hosts.js';

describe('parseDdevHosts', () => {
  const baseConfig = {
    name: 'demo',
    project_tld: 'ddev.site',
    additional_hostnames: ['admin'],
    additional_fqdns: ['shop.example.org'],
  };

  it('derives primary + additional per the spec example', () => {
    const hosts = parseDdevHosts(baseConfig);
    expect(hosts.primary).toBe('demo.ddev.site');
    expect(hosts.additional).toEqual(['admin.ddev.site', 'shop.example.org']);
  });

  it('reordering additional_hostnames/additional_fqdns does not change the result', () => {
    const reordered = {
      ...baseConfig,
      additional_hostnames: ['admin'],
      additional_fqdns: ['shop.example.org'],
    };
    const a = parseDdevHosts(baseConfig);
    const b = parseDdevHosts({
      ...reordered,
      additional_hostnames: [...reordered.additional_hostnames].reverse(),
      additional_fqdns: [...reordered.additional_fqdns].reverse(),
    });
    expect(a).toEqual(b);
  });

  it('two inputs colliding on the same normalized key is a hard error', () => {
    expect(() =>
      parseDdevHosts({
        name: 'demo',
        project_tld: 'ddev.site',
        additional_hostnames: ['Admin'],
        additional_fqdns: ['admin.ddev.site'],
      }),
    ).toThrow(/same value/);
  });

  it('normalizes case and a trailing dot', () => {
    const hosts = parseDdevHosts({
      name: 'Demo',
      project_tld: 'ddev.site.',
      additional_hostnames: [],
      additional_fqdns: [],
    });
    expect(hosts.primary).toBe('demo.ddev.site');
  });

  it('throws on missing name/project_tld rather than guessing', () => {
    expect(() => parseDdevHosts({})).toThrow();
    expect(() => parseDdevHosts({ name: 'demo' })).toThrow();
  });

  it('rejects a wildcard host rather than inventing a concrete one', () => {
    expect(() =>
      parseDdevHosts({
        name: 'demo',
        project_tld: 'ddev.site',
        additional_hostnames: ['*'],
      }),
    ).toThrow(/wildcard/);
  });

  it('dedupes an additional host that already equals the primary', () => {
    const hosts = parseDdevHosts({
      name: 'demo',
      project_tld: 'ddev.site',
      additional_fqdns: ['demo.ddev.site'],
    });
    expect(hosts.additional).toEqual([]);
  });
});

describe('discoverDdevHosts', () => {
  function deps(result: { stdout: string; ok: boolean }): DdevHostsDeps {
    return { run: async () => result };
  }

  it('parses yaml from `ddev utility configyaml` stdout', async () => {
    const result = await discoverDdevHosts(
      '/wt/demo',
      deps({
        ok: true,
        stdout: 'name: demo\nproject_tld: ddev.site\n',
      }),
    );
    expect(result).toEqual({
      ok: true,
      hosts: { primary: 'demo.ddev.site', additional: [] },
    });
  });

  it('a failed command yields ok:false, never a throw', async () => {
    const result = await discoverDdevHosts(
      '/wt/demo',
      deps({ ok: false, stdout: '' }),
    );
    expect(result.ok).toBe(false);
  });

  it('unparseable yaml yields ok:false', async () => {
    const result = await discoverDdevHosts(
      '/wt/demo',
      deps({ ok: true, stdout: ':\n  - [unterminated' }),
    );
    expect(result.ok).toBe(false);
  });

  it('an exec throw still yields ok:false, never propagates', async () => {
    const result = await discoverDdevHosts('/wt/demo', {
      run: async () => {
        throw new Error('boom');
      },
    });
    expect(result.ok).toBe(false);
  });
});
