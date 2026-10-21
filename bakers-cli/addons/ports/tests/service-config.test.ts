import { describe, expect, it } from 'vitest';
import {
  checkWith,
  DEFAULT_STORYBOOK,
  mergeWith,
  serviceRules,
} from '../src/service-config.js';

const keys = (value: unknown) => checkWith(value).map((f) => f.key);

describe('checkWith', () => {
  it('accepts a valid with', () => {
    expect(
      checkWith({
        transport: { use: '@bakers-build/addon-ports-cloudflare-quick' },
        services: [{ key: 'docs', match: 'vitepress' }],
        all_node: true,
      }),
    ).toEqual([]);
  });

  it('accepts an absent with', () => {
    expect(checkWith(undefined)).toEqual([]);
  });

  it('rejects services that is not an array', () => {
    expect(keys({ services: { key: 'docs' } })).toEqual(['services']);
  });

  it('rejects an invalid key at services[0].key', () => {
    expect(keys({ services: [{ key: 'Docs!', match: 'vitepress' }] })).toEqual([
      'services[0].key',
    ]);
  });

  it('rejects an empty match', () => {
    expect(keys({ services: [{ key: 'docs', match: '' }] })).toEqual([
      'services[0].match',
    ]);
  });

  it('rejects an unknown entry field at services[0].port', () => {
    expect(
      keys({ services: [{ key: 'docs', match: 'vitepress', port: 1 }] }),
    ).toEqual(['services[0].port']);
  });

  it('rejects an entry that is not an object', () => {
    expect(keys({ services: ['docs'] })).toEqual(['services[0]']);
  });

  it('rejects a duplicate key', () => {
    expect(
      keys({
        services: [
          { key: 'docs', match: 'vitepress' },
          { key: 'docs', match: 'other' },
        ],
      }),
    ).toEqual(['services[1].key']);
  });

  it('rejects a non-boolean all_node', () => {
    expect(keys({ all_node: 'yes' })).toEqual(['all_node']);
  });

  it('rejects transport without use', () => {
    expect(keys({ transport: { with: {} } })).toEqual(['transport.use']);
  });

  it('rejects an unknown with key', () => {
    expect(keys({ foo: 1 })).toEqual(['foo']);
  });

  it('rejects a with that is not an object', () => {
    expect(keys('ports')).toEqual(['']);
  });
});

describe('mergeWith', () => {
  it('machine entry wins on the same key', () => {
    const merged = mergeWith(
      { services: [{ key: 'docs', match: 'project' }] },
      { services: [{ key: 'docs', match: 'machine' }] },
    ) as { services: unknown[] };
    expect(merged.services).toEqual([{ key: 'docs', match: 'machine' }]);
  });

  it('keeps machine entries first, then project entries the machine lacks', () => {
    const merged = mergeWith(
      { services: [{ key: 'docs', match: 'vitepress' }] },
      { services: [{ key: 'api', match: 'express' }] },
    ) as { services: unknown[] };
    expect(merged.services).toEqual([
      { key: 'api', match: 'express' },
      { key: 'docs', match: 'vitepress' },
    ]);
  });

  it('machine transport-only with keeps project services', () => {
    const merged = mergeWith(
      { services: [{ key: 'docs', match: 'vitepress' }] },
      { transport: { use: 'machine-t' } },
    );
    expect(merged).toEqual({
      transport: { use: 'machine-t' },
      services: [{ key: 'docs', match: 'vitepress' }],
    });
  });

  it('machine all_node false overrides project true', () => {
    expect(
      (
        mergeWith({ all_node: true }, { all_node: false }) as {
          all_node: boolean;
        }
      ).all_node,
    ).toBe(false);
  });

  it('project all_node applies when machine has none', () => {
    expect(
      (
        mergeWith({ all_node: true }, { transport: { use: 'x' } }) as {
          all_node: boolean;
        }
      ).all_node,
    ).toBe(true);
  });

  it('machine transport replaces the project transport whole', () => {
    const merged = mergeWith(
      { transport: { use: 'p', with: { zone: 'p.example' } } },
      { transport: { use: 'm' } },
    );
    expect((merged as { transport: unknown }).transport).toEqual({ use: 'm' });
  });

  it('either side undefined returns the other', () => {
    const value = { services: [{ key: 'docs', match: 'vitepress' }] };
    expect(mergeWith(undefined, value)).toBe(value);
    expect(mergeWith(value, undefined)).toBe(value);
  });
});

describe('serviceRules', () => {
  it('appends storybook only when undefined', () => {
    expect(serviceRules(undefined).entries).toEqual([DEFAULT_STORYBOOK]);
    expect(
      serviceRules({ services: [{ key: 'docs', match: 'vitepress' }] }).entries,
    ).toEqual([{ key: 'docs', match: 'vitepress' }, DEFAULT_STORYBOOK]);
    expect(
      serviceRules({ services: [{ key: 'storybook', match: 'sb' }] }).entries,
    ).toEqual([{ key: 'storybook', match: 'sb' }]);
  });

  it('allNode defaults to false', () => {
    expect(serviceRules(undefined).allNode).toBe(false);
    expect(serviceRules({ all_node: true }).allNode).toBe(true);
  });
});
