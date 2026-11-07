import { describe, expect, it } from 'vitest';
import { AGENT_SHELL_ENV, envArgs } from '../src/panes.js';

describe('parsing', () => {
  it('envArgs forwards only BB_* vars', () => {
    expect(
      envArgs({ BB_PROJECT: 'bakers', TERM: 'xterm', BB_ID: undefined }),
    ).toEqual(['--env', 'BB_PROJECT=bakers']);
  });

  // BB-64: the agent-shell marker is a plain env entry, so it rides the same
  // BB_*-prefix forwarding as every other pane env var — no second mechanism.
  it('envArgs forwards the agent-shell marker', () => {
    expect(envArgs(AGENT_SHELL_ENV)).toEqual(['--env', 'BB_AGENT_SHELL=1']);
  });
});
