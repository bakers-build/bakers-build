import { expect, it } from 'vitest';
import { listTerms } from '../../../../src/Entity/term/Data/terms.js';
import { fakeClient, toResource } from '../../../test-support.js';

// BB-236 — the TERM data service returns TERMS (`bb_term`, what the create popup
// offers as labels). It returns TERMS and knows nothing about forms; the name says
// the entity, not the widget.
//
// BB-257 D3 — but a term only exists inside a VOCABULARY, so the read has to name
// one. `bb_term` alone is not a bundle: dropsh expands the single-segment
// shorthand to `bb_term/bb_term`, which does not exist and 404s (F2), and the
// transport's best-effort rule then rendered the 404 as an empty vocabulary. Which
// vocabulary the caller wants is the CALLER's choice — `label` for this popup,
// `type` or `recipe` for anyone else — so the bundle is a required argument and
// the service stays form-ignorant.

const term = (
  id: string,
  attrs: Record<string, unknown> = {},
): ReturnType<typeof toResource> =>
  toResource({ id, type: 'bb_term--label', attributes: attrs });

it('a term carries id and a label that falls back name → label → uuid', async () => {
  const client = fakeClient({
    rows: {
      'bb_term/label': [
        term('t1', { name: 'bug' }),
        term('t2', { label: 'ui' }),
        term('t3'),
        // An empty string is not a label; nothing may render blank.
        term('t4', { name: '', label: '' }),
      ],
    },
  });
  expect((await listTerms(client, 'label')).rows).toEqual([
    { id: 't1', label: 'bug' },
    { id: 't2', label: 'ui' },
    { id: 't3', label: 't3' },
    { id: 't4', label: 't4' },
  ]);
});

it('AC-3 (F2): the read addresses the BUNDLE, not the entity type alone', async () => {
  // The defect this ticket names, in one assertion. `list(client, 'bb_term', …)`
  // put `bb_term/bb_term` on the wire — measured against the control plane:
  // `bakers dropsh search bb_term --bundle bb_term` → HTTP 404, `--bundle
  // label` → 6 rows. No test could see it until the fake resolved the spec
  // the way dropsh does (D12 / F2b).
  const client = fakeClient({
    rows: {
      'bb_term/label': [
        term('t1', { name: 'bug' }),
        term('t2', { name: 'ui' }),
      ],
    },
  });
  expect((await listTerms(client, 'label')).rows.map((t) => t.id)).toEqual([
    't1',
    't2',
  ]);
  expect(client.collections).toEqual(['bb_term/label']);
});

it('a different vocabulary is a different request, and sees its own rows', async () => {
  // Why the bundle is a required argument rather than a default: `label` is
  // only one of the vocabularies on this entity type, and a future consumer must
  // state which one it wants instead of silently getting a 404.
  const client = fakeClient({
    rows: {
      'bb_term/label': [term('t1', { name: 'bug' })],
      'bb_term/recipe': [term('c1', { name: 'drupal-feature' })],
    },
  });
  expect((await listTerms(client, 'recipe')).rows.map((t) => t.label)).toEqual([
    'drupal-feature',
  ]);
  expect(client.collections).toEqual(['bb_term/recipe']);
});

it('AC-4: a failing term list yields no rows AND the reason, not a silent []', async () => {
  // BB-236 AC-7 keeps the popup openable; BB-257 AC-4 adds that the failure
  // must be SAYABLE. Both come from one outcome: `rows` for the renderer, `error`
  // for the note that replaces `(none available)`.
  const client = fakeClient({
    rows: { 'bb_term/label': [term('t1', { name: 'bug' })] },
    failingCollections: ['bb_term/label'],
  });
  const outcome = await listTerms(client, 'label');
  expect(outcome.rows).toEqual([]);
  expect(outcome.error).toBe('no bb_term/label');
});
