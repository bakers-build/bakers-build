import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CONDUCTOR_MINE,
  hiddenNotice,
  mineBadges,
  OwnerIdentity,
} from '../../../../src/Entity/conductor/Data/own-rows.js';

const client = {} as never;
const resolver = (rows: { id: string; label: string }[], error?: string) =>
  vi.fn(async () => ({ rows, ...(error === undefined ? {} : { error }) }));

describe('OwnerIdentity (BB-460 D5)', () => {
  it('resolves the username to a uuid and caches it', async () => {
    const resolve = resolver([{ id: 'user-cw', label: 'cw' }]);
    const identity = new OwnerIdentity(resolve);
    expect(await identity.resolve(client, 'cw')).toEqual({
      kind: 'resolved',
      id: 'user-cw',
      label: 'cw',
    });
    await identity.resolve(client, 'cw');
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('no currentUser: unavailable, and no read at all', async () => {
    const resolve = resolver([]);
    const identity = new OwnerIdentity(resolve);
    const outcome = await identity.resolve(client, undefined);
    expect(outcome).toEqual({
      kind: 'unavailable',
      reason: 'mine: no current user',
    });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('a name that matches nobody is a DEFINITIVE miss and is cached', async () => {
    const resolve = resolver([]);
    const identity = new OwnerIdentity(resolve);
    expect(await identity.resolve(client, 'ghost')).toEqual({
      kind: 'unavailable',
      reason: "mine: 'ghost' not found",
    });
    await identity.resolve(client, 'ghost');
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('a READ ERROR is not cached — the next load retries (BB-287 D5)', async () => {
    const resolve = resolver([], 'network down');
    const identity = new OwnerIdentity(resolve);
    expect(await identity.resolve(client, 'cw')).toEqual({
      kind: 'unavailable',
      reason: 'mine: network down',
    });
    await identity.resolve(client, 'cw');
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it('a thrown resolver is an error outcome, never a rejection', async () => {
    const resolve = vi.fn(async () => {
      throw new Error('boom');
    });
    const identity = new OwnerIdentity(resolve as never);
    expect(await identity.resolve(client, 'cw')).toEqual({
      kind: 'unavailable',
      reason: 'mine: boom',
    });
  });
});

describe('the mine badges and notice (BB-460 D1/D2/AC-2)', () => {
  it('the shipped default is ON', () => {
    expect(DEFAULT_CONDUCTOR_MINE).toBe(true);
  });

  it('ON shows the active value; OFF shows the key hint', () => {
    expect(mineBadges(true)).toEqual([
      { id: 'mine', label: 'm mine', value: 'mine' },
      { id: 'clear', label: 'c clear' },
    ]);
    expect(mineBadges(false)).toEqual([
      { id: 'mine', label: 'm mine' },
      { id: 'clear', label: 'c clear' },
    ]);
  });

  it('states the hidden rows, singular and plural, with the key that frees them', () => {
    expect(hiddenNotice(5)).toBe('5 hidden by mine — press m');
    expect(hiddenNotice(1)).toBe('1 hidden by mine — press m');
  });

  it('says nothing when nothing is hidden or nothing is established', () => {
    expect(hiddenNotice(0)).toBe('');
    expect(hiddenNotice(null)).toBe('');
  });
});
