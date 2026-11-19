import { HttpError } from 'dropsh/plugin';
import { describe, expect, it } from 'vitest';
import { httpErrorText } from '../../src/core/http-error.js';

describe('httpErrorText', () => {
  it("adds the server's JSON:API title and detail to the status", () => {
    const err = new HttpError(426, 'HTTP 426', {
      errors: [
        {
          title: 'Upgrade Required',
          detail:
            'bakers 0.10.1 is too old for this server (requires >= 0.11.0).',
        },
      ],
    });
    expect(httpErrorText(err)).toBe(
      'HTTP 426 Upgrade Required: bakers 0.10.1 is too old for this server (requires >= 0.11.0).',
    );
  });

  it('gives the bare status for an HTTP error without an error body', () => {
    expect(httpErrorText(new HttpError(500, 'HTTP 500'))).toBe('HTTP 500');
  });

  it('gives String(err) for any other error', () => {
    expect(httpErrorText(new Error('boom'))).toBe('Error: boom');
  });
});
