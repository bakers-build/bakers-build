import { expect, it } from 'vitest';
import { loadTicketDetail } from '../../../../src/Entity/ticket/Data/detail.js';

// Fake dropsh client exposing only `.get(path)`; records every call.
function fakeClient(responses) {
  const calls = [];
  return {
    calls,
    async get(p) {
      calls.push({ kind: 'get', path: p });
      return responses.gets[p];
    },
  };
}

it('loadTicketDetail requests the include set', async () => {
  const doc = { data: { id: 't1', attributes: {} }, included: [] };
  // BB-233 AC-12: `conductor_id,assignee_user_id` joined the include set so
  // the Assignment section gets its labels sideloaded — pinning the exact path
  // is what makes dropping one of them fail loudly instead of rendering uuids.
  // BB-255 AC-3/AC-8: `parent_id,labels` joined it for the same reason — both
  // were measured to resolve under the `session` profile the TUI pins, and
  // without them the Parent row and the header's labels can only be uuids.
  // BB-252 needs `parent_id` too: this document is mapped to a list row after a
  // save, and without it the row's Parent column silently blanks. Two consumers,
  // one include set — this is the assertion that makes dropping either loud.
  // BB-369 AC-3: `blocked_by` joined the set so the Related tab's Blocked by
  // rows are identities (`<identifier> · <title>`) rather than raw uuids. The
  // linkage data arrives WITHOUT an include, so dropping it here would degrade
  // the rows silently instead of emptying the section — which is what makes
  // pinning the exact path, and not just the section's output, the real guard.
  // BAKERS-17: `ticket_type,recipe` joined it for the header's term names.
  const path =
    'bb_ticket/bb_ticket/t1?include=comments,sub_tickets,runs,referenced_tickets,conductor_id,assignee_user_id,parent_id,labels,ticket_type,recipe,blocked_by,owner_user_id,reviewers,pending_reviews';
  const client = fakeClient({ gets: { [path]: doc } });
  expect(await loadTicketDetail(client, 't1')).toBe(doc);
});
