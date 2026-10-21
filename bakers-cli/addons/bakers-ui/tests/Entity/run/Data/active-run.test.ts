import { expect, it } from 'vitest';
import { activeRunInfo } from '../../../../src/Entity/run/Data/active-run.js';
import type { TicketDetailDocument } from '../../../../src/types.js';

// BB-236 AC-8: `activeRunInfo` derives a RUN fact, so it belongs with the other run
// derivations, not in a form module. These are !267's own AC-8 cases, moved verbatim
// from `tests/Service/edit-form.test.ts` — a relocation, not a rewrite.

const COND = 'bbbbbbbb-0000-0000-0000-000000000001';
const TICKET = 'cccccccc-0000-0000-0000-000000000001';

function doc(
  rel: { assignee?: string | null; conductor?: string | null } = {},
  extra: { attributes?: Record<string, unknown>; runs?: string[] } = {},
): TicketDetailDocument {
  return {
    data: {
      id: TICKET,
      type: 'bb_ticket--bb_ticket',
      attributes: { identifier: 'BB-233', ...(extra.attributes ?? {}) },
      relationships: {
        assignee_user_id: { data: rel.assignee ? { id: rel.assignee } : null },
        conductor_id: { data: rel.conductor ? { id: rel.conductor } : null },
        runs: { data: (extra.runs ?? []).map((id) => ({ id })) },
      },
    },
    included: [],
  };
}

it('AC-8: activeRunInfo reports a running run and names the machine', () => {
  const d = doc(
    { conductor: COND },
    {
      attributes: {
        derived_status: 'running',
        claim_machine: 'cw-framework',
      },
      runs: ['r1'],
    },
  );
  d.included = [
    {
      id: 'r1',
      type: 'bb_run--bb_run',
      attributes: { state: 'running' },
    },
  ];
  expect(activeRunInfo(d)).toEqual({
    identifier: 'BB-233',
    machine: 'cw-framework',
    runState: 'running',
  });
});

it('AC-8: a claimed run counts too', () => {
  const d = doc({ conductor: COND }, { runs: ['r1'] });
  d.included = [
    { id: 'r1', type: 'bb_run--bb_run', attributes: { state: 'claimed' } },
  ];
  expect(activeRunInfo(d)?.runState).toBe('claimed');
});

it('AC-8: no warning for terminal runs, no runs, or an idle ticket', () => {
  const terminal = doc({ conductor: COND }, { runs: ['r1'] });
  terminal.included = [
    { id: 'r1', type: 'bb_run--bb_run', attributes: { state: 'done' } },
  ];
  expect(activeRunInfo(terminal)).toBeNull();
  expect(activeRunInfo(doc({ conductor: COND }))).toBeNull();
  expect(activeRunInfo({})).toBeNull();
});

it('AC-8: derived_status running alone is enough (includes may be absent)', () => {
  const d = doc(
    { conductor: COND },
    { attributes: { derived_status: 'running', claim_machine: 'box-2' } },
  );
  expect(activeRunInfo(d)).toEqual({
    identifier: 'BB-233',
    machine: 'box-2',
    runState: 'running',
  });
});
