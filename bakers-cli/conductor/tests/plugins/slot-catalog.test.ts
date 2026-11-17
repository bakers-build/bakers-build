import { describe, expect, it, vi } from 'vitest';
import type { Ticket } from '../../src/plugins/remote.js';
import {
  type SlotCatalog,
  SlotResolver,
  selectSlot,
} from '../../src/plugins/slot-catalog.js';

const ticket = (over: Partial<Ticket> = {}): Ticket => ({
  uuid: 'u',
  identifier: 'BB-1',
  title: 't',
  state: 'coding',
  branchName: 'b',
  labels: [],
  environments: [],
  ...over,
});

const catalog = (
  over: Partial<SlotCatalog<string>> = {},
): SlotCatalog<string> => ({
  slot: 'runtime',
  entries: { a: 'A', b: 'B', c: 'C', d: 'D', e: 'E', f: 'F' },
  default: 'f',
  routes: {},
  ...over,
});

describe('selectSlot order (first hit wins)', () => {
  it('1. permitted label', () => {
    const c = catalog({
      routes: { default: { '*': 'b' } },
      projectDefault: 'c',
    });
    expect(selectSlot(c, ticket({ labels: ['runtime:a'] }))).toEqual({
      alias: 'a',
      reason: 'label',
      label: 'runtime:a',
    });
  });

  it('1b. label scoped to the ticket state wins; other state ignored', () => {
    const c = catalog();
    const t = ticket({
      labels: ['runtime:a', 'runtime:b@coding', 'runtime:c@plan'],
    });
    expect(selectSlot(c, t)).toMatchObject({
      alias: 'b',
      label: 'runtime:b@coding',
    });
    expect(selectSlot(c, ticket({ labels: ['runtime:c@plan'] })).reason).toBe(
      'fallback',
    );
  });

  it('2. named route from a label, by state then *', () => {
    const c = catalog({ routes: { fast: { coding: 'b', '*': 'c' } } });
    expect(selectSlot(c, ticket({ labels: ['runtime:fast'] }))).toEqual({
      alias: 'b',
      reason: 'label',
      label: 'runtime:fast',
    });
    expect(
      selectSlot(c, ticket({ state: 'plan', labels: ['runtime:fast'] })).alias,
    ).toBe('c');
  });

  it('2b. a label route resolving to a disallowed alias warns and continues', () => {
    const warn = vi.fn();
    const c = catalog({ routes: { fast: { '*': 'b' } }, projectDefault: 'e' });
    const got = selectSlot(c, ticket({ labels: ['runtime:fast'] }), {
      labelAllowed: (x) => x !== 'b',
      warn,
    });
    expect(got).toEqual({ alias: 'e', reason: 'project' });
    expect(warn).toHaveBeenCalledOnce();
  });

  it('2c. inherited keys are unknown aliases', () => {
    expect(() =>
      selectSlot(catalog(), ticket({ labels: ['runtime:toString'] })),
    ).toThrow(/unknown alias 'toString'/);
  });

  it('3. machine route for the state, then default-route *', () => {
    const c = catalog({
      routes: { default: { '*': 'c', coding: 'd' } },
      projectDefault: 'e',
    });
    expect(selectSlot(c, ticket())).toEqual({ alias: 'd', reason: 'route' });
    expect(selectSlot(c, ticket({ state: 'plan' }))).toEqual({
      alias: 'c',
      reason: 'default-route',
    });
  });

  it('4. project default', () => {
    const c = catalog({ projectDefault: 'e', preset: 'a' });
    expect(selectSlot(c, ticket())).toEqual({ alias: 'e', reason: 'project' });
  });

  it('5. addon preset', () => {
    const c = catalog({ preset: 'a' });
    expect(selectSlot(c, ticket())).toEqual({ alias: 'a', reason: 'preset' });
  });

  it('6. built-in fallback (fallback, else default)', () => {
    expect(selectSlot(catalog({ fallback: 'e' }), ticket())).toEqual({
      alias: 'e',
      reason: 'fallback',
    });
    expect(selectSlot(catalog(), ticket()).alias).toBe('f');
  });

  it('a label rejected by labelAllowed warns and the order continues', () => {
    const warn = vi.fn();
    const c = catalog({ projectDefault: 'e' });
    const t = ticket({ labels: ['runtime:a', 'runtime:b'] });
    const got = selectSlot(c, t, { labelAllowed: (x) => x === 'b', warn });
    expect(got).toEqual({ alias: 'b', reason: 'label', label: 'runtime:b' });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain('BB-1');
    expect(warn.mock.calls[0]?.[0]).toContain("'a'");
    const none = selectSlot(c, ticket({ labels: ['runtime:a'] }), {
      labelAllowed: () => false,
      warn,
    });
    expect(none).toEqual({ alias: 'e', reason: 'project' });
  });

  it('unknown label alias, empty alias and malformed label throw', () => {
    for (const label of ['runtime:nope', 'runtime:', 'runtime:a@coding@x']) {
      expect(() => selectSlot(catalog(), ticket({ labels: [label] }))).toThrow(
        /runtime/,
      );
    }
  });

  it('ignores labels of other slots', () => {
    expect(
      selectSlot(catalog(), ticket({ labels: ['agent:zzz'] })).reason,
    ).toBe('fallback');
  });
});

describe('select function', () => {
  it('replaces the whole order', () => {
    const select = vi.fn(() => 'e');
    const c = catalog({ select, projectDefault: 'c' });
    expect(selectSlot(c, ticket({ labels: ['runtime:a'] }))).toEqual({
      alias: 'e',
      reason: 'function',
    });
    expect(select).toHaveBeenCalledWith(
      ['a', 'b', 'c', 'd', 'e', 'f'],
      expect.anything(),
    );
  });

  it('unknown alias throws naming slot and value', () => {
    const c = catalog({ select: () => 'zzz' });
    expect(() => selectSlot(c, ticket())).toThrow(/runtime.*zzz/);
  });

  it('a throw is rethrown wrapped with slot and message', () => {
    const c = catalog({
      select: () => {
        throw new Error('boom');
      },
    });
    expect(() => selectSlot(c, ticket())).toThrow(/runtime.*boom/);
  });
});

describe('SlotResolver', () => {
  it('builds once per slot/alias', async () => {
    const r = new SlotResolver();
    const build = vi.fn(async () => ({}));
    const [x, y] = await Promise.all([
      r.instance('runtime', 'a', build),
      r.instance('runtime', 'a', build),
    ]);
    await r.instance('runtime', 'b', build);
    await r.instance('agent', 'a', build);
    expect(x).toBe(y);
    expect(build).toHaveBeenCalledTimes(3);
  });

  it('retries a build that failed', async () => {
    const r = new SlotResolver();
    const build = vi
      .fn<() => Promise<object>>()
      .mockRejectedValueOnce(new Error('daemon down'))
      .mockResolvedValue({});
    await expect(r.instance('runtime', 'a', build)).rejects.toThrow(
      'daemon down',
    );
    await expect(r.instance('runtime', 'a', build)).resolves.toEqual({});
    expect(build).toHaveBeenCalledTimes(2);
  });
});
