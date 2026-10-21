import { expect, it } from 'vitest';
import { serverMessage } from '../../src/lib/jsonapi-error.js';

// BB-233 AC-5. dropsh's `HttpError.message` is the literal string `HTTP 403`
// / `HTTP 422` — the server's own words live in `err.body.errors[]`. Every case
// below is a body MEASURED against the live control plane on 2026-07-26 and
// pasted in verbatim, so a naive `caught.message` implementation cannot pass.

/** The shape dropsh throws: `{ status, message, body }` (core/http.js). */
const httpError = (
  status: number,
  body: unknown,
): Error & {
  status: number;
  body: unknown;
} =>
  Object.assign(new Error(`HTTP ${status}`), { status, body }) as Error & {
    status: number;
    body: unknown;
  };

it('field-level 403: yields the server detail, never "HTTP 403"', () => {
  const caught = httpError(403, {
    errors: [
      {
        title: 'Forbidden',
        status: '403',
        detail:
          'The current user is not allowed to PATCH the selected field (conductor_id). Assigning a conductor requires the "assign bakers conductor" permission.',
      },
    ],
  });
  expect(serverMessage(caught)).toBe(
    'The current user is not allowed to PATCH the selected field (conductor_id). Assigning a conductor requires the "assign bakers conductor" permission.',
  );
  expect(serverMessage(caught)).not.toBe('HTTP 403');
});

it('field-level 403 on assignee_user_id: the terminal-ticket wording', () => {
  expect(
    serverMessage(
      httpError(403, {
        errors: [
          {
            title: 'Forbidden',
            status: '403',
            detail:
              'The current user is not allowed to PATCH the selected field (assignee_user_id). A terminal ticket may only receive its permitted lifecycle cleanup fields outside a run scope.',
          },
        ],
      }),
    ),
  ).toContain('assignee_user_id');
});

// THE case a naive implementation gets wrong: JSON:API makes `detail` optional,
// and an entity-level 403 can carry nothing but its title. Falling through to
// `HTTP 403` here would put the useless string on screen; falling through to
// `''` would show an empty footer, which reads as "it worked".
it('entity-level 403 with an empty detail falls back to the title', () => {
  expect(
    serverMessage(
      httpError(403, {
        errors: [{ title: 'Forbidden', status: '403', detail: '' }],
      }),
    ),
  ).toBe('Forbidden');
  expect(
    serverMessage(httpError(403, { errors: [{ title: 'Forbidden' }] })),
  ).toBe('Forbidden');
});

it('422 with a field pointer', () => {
  expect(
    serverMessage(
      httpError(422, {
        errors: [
          {
            title: 'Unprocessable Content',
            status: '422',
            detail: "state.0: The state 'not_a_state' is invalid.",
          },
        ],
      }),
    ),
  ).toBe("state.0: The state 'not_a_state' is invalid.");
});

it('404 on an unknown relationship target', () => {
  expect(
    serverMessage(
      httpError(404, {
        errors: [
          {
            title: 'Not Found',
            status: '404',
            detail:
              'The resource identified by `bb_conductor--bb_conductor:00000000-dead-beef-0000-000000000000` (given as a relationship item) could not be found.',
          },
        ],
      }),
    ),
  ).toContain('could not be found');
});

it('joins several errors[] entries', () => {
  expect(
    serverMessage(
      httpError(422, {
        errors: [
          { title: 'Unprocessable Content', detail: 'first problem.' },
          { title: 'Unprocessable Content', detail: 'second problem.' },
        ],
      }),
    ),
  ).toBe('first problem. second problem.');
});

it('an HttpError with no usable errors[] falls back to HTTP <status>', () => {
  expect(serverMessage(httpError(500, { errors: [] }))).toBe('HTTP 500');
  expect(serverMessage(httpError(502, undefined))).toBe('HTTP 502');
  expect(serverMessage(httpError(503, { errors: [{}] }))).toBe('HTTP 503');
});

it('a non-HttpError throw stringifies', () => {
  expect(serverMessage(new Error('socket hang up'))).toBe('socket hang up');
  expect(serverMessage('plain string')).toBe('plain string');
  expect(serverMessage(undefined)).toBe('undefined');
});

it('trims and ignores whitespace-only detail', () => {
  expect(
    serverMessage(
      httpError(403, { errors: [{ title: 'Forbidden', detail: '   ' }] }),
    ),
  ).toBe('Forbidden');
});
