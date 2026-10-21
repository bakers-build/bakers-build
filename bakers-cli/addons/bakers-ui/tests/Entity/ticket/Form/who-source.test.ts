import { describe, expect, it } from 'vitest';
import {
  WHO_MIN_QUERY_LENGTH,
  whoOptionSource,
} from '../../../../src/Entity/ticket/Form/who-source.js';
import { fakeClient } from '../../../test-support.js';

// BB-299 D6/AC-5 — the two-character gate lives INSIDE the source's load(),
// never in the kernel and never by a caller skipping the call: below
// WHO_MIN_QUERY_LENGTH the source returns an empty bag WITHOUT touching the
// client, and that includes the `prime('')` at open — opening the picker
// issues no query at all. The proof is a recording client: zero `get`s at 0
// and 1 characters, the first `get` at 2.

const USERS = 'user/user';

const user = (id: string, attrs: Record<string, unknown>) => ({
  id,
  type: 'user--user',
  attributes: attrs,
});

const queryOf = (params: unknown): string =>
  decodeURIComponent((params as { getQueryString(): string }).getQueryString());

describe('whoOptionSource — the two-character gate (BB-299 D6/AC-5)', () => {
  it('names the threshold as a constant of 2', () => {
    expect(WHO_MIN_QUERY_LENGTH).toBe(2);
  });

  it('the prime and a one-character query issue NO client call and yield an empty bag', async () => {
    const client = fakeClient({
      documents: {
        [USERS]: { data: [user('u2', { name: 'cw' })] },
      },
    });
    const source = whoOptionSource(client);
    // '' is exactly what `primeSources` loads with at open.
    expect(await source.load('')).toEqual({ options: [] });
    expect(await source.load('c')).toEqual({ options: [] });
    expect(client.requests).toEqual([]);
  });

  it('the first server query happens at two characters — name CONTAINS the typed fragment', async () => {
    const client = fakeClient({
      documents: {
        [USERS]: {
          data: [
            user('u2', {
              display_name: 'cw',
              name: 'cw',
              drupal_internal__uid: 2,
            }),
          ],
        },
      },
    });
    const outcome = await whoOptionSource(client).load('cw');
    expect(client.requests).toHaveLength(1);
    expect(client.requests[0]?.path).toBe(USERS);
    const s = queryOf(client.requests[0]?.params);
    expect(s).toContain('name');
    expect(s).toContain('CONTAINS');
    expect(s).toContain('cw');
    expect(outcome.options).toEqual([{ id: 'u2', label: 'cw' }]);
  });

  it('a uid-0 row in the response is dropped (F6 — Anonymous is never an assignee)', async () => {
    const client = fakeClient({
      documents: {
        [USERS]: {
          data: [
            user('u0', {
              display_name: 'Anonymous',
              name: '',
              drupal_internal__uid: 0,
            }),
            user('u2', {
              display_name: 'cw',
              name: 'cw',
              drupal_internal__uid: 2,
            }),
          ],
        },
      },
    });
    const outcome = await whoOptionSource(client).load('cw');
    expect(outcome.options.map((o) => o.id)).toEqual(['u2']);
  });
});
