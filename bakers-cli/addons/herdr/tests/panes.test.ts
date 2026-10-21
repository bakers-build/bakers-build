import { describe, expect, it } from 'vitest';
import {
  AGENT_SHELL_ENV,
  envArgs,
  findTabIdByLabel,
  parsePaneInfo,
  parsePanesInTab,
  parseTabCreate,
} from '../src/panes.js';

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

  it('parseTabCreate reads root pane + tab ids', () => {
    expect(
      parseTabCreate(
        JSON.stringify({
          result: { root_pane: { pane_id: 'p1' }, tab: { tab_id: 't1' } },
        }),
      ),
    ).toEqual({ paneId: 'p1', tabId: 't1' });
  });

  it('parsePaneInfo reads current pane + tab', () => {
    expect(
      parsePaneInfo(
        JSON.stringify({ result: { pane: { pane_id: 'p2', tab_id: 't1' } } }),
      ),
    ).toEqual({ paneId: 'p2', tabId: 't1' });
  });

  it('findTabIdByLabel matches the label, else null', () => {
    const out = JSON.stringify({
      result: {
        tabs: [
          { tab_id: 't1', label: 'other' },
          { tab_id: 't9', label: 'bakers-ticket-agents' },
        ],
      },
    });
    expect(findTabIdByLabel(out, 'bakers-ticket-agents')).toBe('t9');
    expect(findTabIdByLabel(out, 'missing')).toBeNull();
  });

  it('parsePanesInTab filters to the tab + keeps labels', () => {
    const out = JSON.stringify({
      result: {
        panes: [
          { pane_id: 'p1', tab_id: 't9', label: 'ticket-create:bakers:s1' },
          { pane_id: 'p2', tab_id: 't9' }, // no label -> ''
          { pane_id: 'pX', tab_id: 'tOther', label: 'x' }, // other tab -> skip
        ],
      },
    });
    expect(parsePanesInTab(out, 't9')).toEqual([
      { paneId: 'p1', tabId: 't9', label: 'ticket-create:bakers:s1' },
      { paneId: 'p2', tabId: 't9', label: '' },
    ]);
  });
});
