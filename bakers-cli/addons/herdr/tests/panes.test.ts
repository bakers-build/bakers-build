import { describe, expect, it } from 'vitest';
import { AGENT_SHELL_ENV, envArgs } from '../src/panes.js';

describe('parsing', () => {
  it('envArgs forwards only BAKERS_* vars', () => {
    expect(
      envArgs({
        BAKERS_PROJECT: 'bakers',
        TERM: 'xterm',
        BAKERS_ID: undefined,
      }),
    ).toEqual(['--env', 'BAKERS_PROJECT=bakers']);
  });

  // BB-64: the agent-shell marker is a plain env entry, so it rides the same
  // BAKERS_*-prefix forwarding as every other pane env var — no second mechanism.
  it('envArgs forwards the agent-shell marker', () => {
    expect(envArgs(AGENT_SHELL_ENV)).toEqual(['--env', 'BAKERS_AGENT_SHELL=1']);
  });
});
