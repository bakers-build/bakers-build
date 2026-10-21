import { HttpError } from 'dropsh/plugin';
import { describe, expect, it } from 'vitest';
import { hideUnpublishedComments } from '../src/unpublished-comments.js';

const comment = (
  id: string,
  status: boolean,
  type = 'bb_comment--review',
) => ({
  type,
  id,
  attributes: { status, body: { value: `body ${id}` } },
});

function serve(body: unknown, status = 200) {
  const sent: string[] = [];
  const http = hideUnpublishedComments({
    send: async (req) => {
      sent.push(req.method);
      return {
        status,
        headers: { 'content-type': 'application/vnd.api+json' },
        body: JSON.stringify(body),
      };
    },
  });
  return { http, sent };
}

const get = { method: 'GET' as const, url: 'https://x.test/jsonapi/x' };

describe('bakers dropsh hides unpublished comments from agent reads', () => {
  it('drops unpublished comments from a collection', async () => {
    const { http } = serve({
      data: [
        comment('a', true, 'bb_comment--bb_comment'),
        comment('b', false),
      ],
    });
    const out = JSON.parse((await http.send(get)).body);
    expect(out.data.map((r: { id: string }) => r.id)).toEqual(['a']);
  });

  it('fails a single read of an unpublished comment as not found', async () => {
    const { http } = serve({ data: comment('b', false) });
    const failure = await http.send(get).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(HttpError);
    expect((failure as HttpError).status).toBe(404);
    expect(JSON.stringify(failure)).not.toContain('body b');
  });

  it('drops unpublished includes and their relationship linkages', async () => {
    const { http } = serve({
      data: {
        type: 'bb_ticket--bb_ticket',
        id: 't',
        attributes: {},
        relationships: {
          comments: { data: [{ type: 'bb_comment--review', id: 'a' }] },
          pending_reviews: {
            data: [{ type: 'bb_comment--review', id: 'b' }],
          },
        },
      },
      included: [comment('a', true), comment('b', false)],
    });
    const out = JSON.parse((await http.send(get)).body);
    expect(out.included.map((r: { id: string }) => r.id)).toEqual(['a']);
    expect(out.data.relationships.comments.data).toHaveLength(1);
    expect(out.data.relationships.pending_reviews.data).toEqual([]);
    expect(JSON.stringify(out)).not.toContain('body b');
  });

  it('passes published comments, other types and writes through unchanged', async () => {
    const body = {
      data: [
        comment('a', true),
        {
          type: 'bb_ticket--bb_ticket',
          id: 't',
          attributes: { status: false },
        },
      ],
    };
    const { http } = serve(body);
    expect(JSON.parse((await http.send(get)).body)).toEqual(body);
    const write = serve({ data: comment('b', false) });
    const res = await write.http.send({ ...get, method: 'PATCH' });
    expect(res.status).toBe(200);
    expect(res.body).toContain('body b');
  });

  it('leaves non-JSON and error bodies alone', async () => {
    const http = hideUnpublishedComments({
      send: async () => ({
        status: 500,
        headers: {},
        body: '<html>oops</html>',
      }),
    });
    expect((await http.send(get)).body).toBe('<html>oops</html>');
  });
});
