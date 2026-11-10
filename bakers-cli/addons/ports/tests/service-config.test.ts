import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STORYBOOK,
  duplicateServiceKey,
  mergeWith,
  serviceRules,
} from '../src/service-config.js';

describe('duplicateServiceKey', () => {
  it('accepts distinct keys and an absent with', () => {
    expect(
      duplicateServiceKey({
        services: [
          { key: 'docs', match: 'vitepress' },
          { key: 'api', match: 'express' },
        ],
      }),
    ).toBeUndefined();
    expect(duplicateServiceKey(undefined)).toBeUndefined();
  });

  it('names the second entry of a duplicate key', () => {
    expect(
      duplicateServiceKey({
        services: [
          { key: 'docs', match: 'vitepress' },
          { key: 'docs', match: 'other' },
        ],
      }),
    ).toBe("services[1].key duplicates 'docs'");
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
