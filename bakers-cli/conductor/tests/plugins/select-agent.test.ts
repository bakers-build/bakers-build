import { describe, expect, it, vi } from 'vitest';
import type { BbAgent } from '../../src/plugins/agent.js';
import {
  type ResolvedAgent,
  resolveAgent,
  selectAgent,
} from '../../src/plugins/plugins.js';
import type { Ticket } from '../../src/plugins/remote.js';

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

const agent = (id: string): BbAgent => ({
  id,
  launchCommand: () => id,
  getRunLog: async () => '',
  parseFootprint: () => ({
    tokens: 0,
    agent_turns: 0,
    tool_calls: 0,
    user_prompts: 0,
    user_prompt_words: 0,
  }),
});

const cand = (id: string, priority?: (t: Ticket) => number): ResolvedAgent => ({
  id,
  alias: id,
  agent: agent(id),
  ...(priority ? { priority } : {}),
});

describe('selectAgent', () => {
  it('returns the only candidate', () => {
    expect(selectAgent([cand('a')], ticket()).id).toBe('a');
  });

  it('picks the highest priority and breaks ties by catalog order', () => {
    expect(
      selectAgent(
        [cand('lo', () => 1), cand('first', () => 9), cand('second', () => 9)],
        ticket(),
      ).id,
    ).toBe('first');
  });

  it('treats a missing priority as strictly lowest', () => {
    expect(
      selectAgent([cand('bare'), cand('scored', () => -100)], ticket()).id,
    ).toBe('scored');
  });
});

describe('resolveAgent', () => {
  const candidates = [
    'scoped',
    'direct',
    'route-state',
    'route-star',
    'default-state',
    'default-star',
    'simple',
  ].map((id) => cand(id));
  const options = {
    routes: {
      named: { coding: 'route-state', '*': 'route-star' },
      default: { coding: 'default-state', '*': 'default-star' },
    },
    defaultAgent: 'simple',
  };

  it('uses scoped direct, direct, scoped route, then route precedence', () => {
    expect(
      resolveAgent(
        candidates,
        ticket({ labels: ['agent:direct', 'agent:scoped@coding'] }),
        options,
      ).alias,
    ).toBe('scoped');
    expect(
      resolveAgent(
        candidates,
        ticket({ labels: ['agent:named', 'agent:direct'] }),
        options,
      ).alias,
    ).toBe('direct');
    expect(
      resolveAgent(
        candidates,
        ticket({ labels: ['agent:named', 'agent:named@coding'] }),
        options,
      ).alias,
    ).toBe('route-state');
    expect(
      resolveAgent(candidates, ticket({ labels: ['agent:named'] }), options)
        .alias,
    ).toBe('route-state');
  });

  it('prefers a direct alias when an alias and route have the same name', () => {
    const same = cand('named');
    expect(
      resolveAgent(
        [same, ...candidates],
        ticket({ labels: ['agent:named'] }),
        options,
      ),
    ).toBe(same);
  });

  it('falls through reserved default state, reserved default star, then simple default', () => {
    expect(resolveAgent(candidates, ticket(), options).alias).toBe(
      'default-state',
    );
    expect(
      resolveAgent(candidates, ticket({ state: 'review' }), options).alias,
    ).toBe('default-star');
    expect(
      resolveAgent(candidates, ticket(), {
        routes: { default: { coding: 'missing' } },
        defaultAgent: 'simple',
        warn: () => undefined,
      }).alias,
    ).toBe('simple');
  });

  it('warns for unavailable direct and route targets, then continues', () => {
    const warn = vi.fn();
    expect(
      resolveAgent(
        candidates,
        ticket({ labels: ['agent:missing', 'agent:broken'] }),
        {
          routes: {
            broken: { coding: 'disabled' },
            default: { '*': 'default-star' },
          },
          defaultAgent: 'simple',
          warn,
        },
      ).alias,
    ).toBe('default-star');
    expect(warn.mock.calls.map(([message]) => message)).toEqual([
      expect.stringContaining("BB-1: agent alias 'missing' is unavailable"),
      expect.stringContaining(
        "BB-1: agent route 'broken' resolves to unavailable alias 'disabled'",
      ),
    ]);
  });

  it('uses priority/order fallback after all configured selectors', () => {
    const fallback = [cand('first', () => 1), cand('winner', () => 2)];
    expect(
      resolveAgent(fallback, ticket(), {
        routes: {},
        defaultAgent: 'missing',
        warn: () => undefined,
      }).alias,
    ).toBe('winner');
  });

  it('lets a custom selector replace the whole resolution', () => {
    const selected = candidates[1];
    expect(
      resolveAgent(candidates, ticket({ labels: ['agent:scoped'] }), {
        ...options,
        selectAgent: () => selected,
      }),
    ).toBe(selected);
  });
});
