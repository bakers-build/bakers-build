import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBakersClient } from './bakers-client.mjs';
import { bakersStub } from '../test/stubs.mjs';

async function setup(t, options = {}) {
  const stub = await bakersStub({ tools: { bakers_ticket_read: (args) => ({ id: 't-1', identifier: args.ticket }) }, ...options });
  t.after(stub.close);
  const client = createBakersClient({ url: `${stub.url}/`, apiKey: 'bb-test-key' });
  return { stub, client };
}

test('the client offers bakers tools only', async (t) => {
  const { client } = await setup(t);
  assert.deepEqual(Object.keys(client), ['tool']);
});

test('a bakers.build tool is called over /mcp and its JSON result returned', async (t) => {
  const { stub, client } = await setup(t);
  assert.deepEqual(await client.tool('bakers_ticket_read', { ticket: 'ACME-1' }), { id: 't-1', identifier: 'ACME-1' });
  assert.deepEqual(stub.calls('bakers_ticket_read'), [{ ticket: 'ACME-1' }]);
});

test('every request carries the API key as a static bearer and nothing else is asked for', async (t) => {
  const { stub, client } = await setup(t);
  await client.tool('bakers_ticket_read', { ticket: 'ACME-1' });
  await client.tool('bakers_ticket_read', { ticket: 'ACME-2' });
  assert.ok(stub.requests.length > 0);
  for (const r of stub.requests) {
    assert.equal(r.path, '/mcp');
    assert.equal(r.headers.authorization, 'Bearer bb-test-key');
  }
});

test('a JSON answer is read as well as a server-sent event', async (t) => {
  const { client } = await setup(t, { sse: false });
  assert.deepEqual(await client.tool('bakers_ticket_read', { ticket: 'ACME-1' }), { id: 't-1', identifier: 'ACME-1' });
});

test('a rejected key is an error naming the tool and the status, without a retry', async (t) => {
  const { stub, client } = await setup(t);
  stub.revoke();
  await assert.rejects(client.tool('bakers_ticket_read', { ticket: 'ACME-1' }), /bakers_ticket_read.*401/);
  assert.equal(stub.requests.length, 1);
});

test('a refused connection is an error naming the tool, and the next call works once the site is back', async (t) => {
  const { stub, client } = await setup(t);
  await stub.down();
  await assert.rejects(client.tool('bakers_ticket_read', { ticket: 'ACME-1' }), /bakers_ticket_read.*ECONNREFUSED/);
  await stub.up();
  assert.deepEqual(await client.tool('bakers_ticket_read', { ticket: 'ACME-1' }), { id: 't-1', identifier: 'ACME-1' });
});

test('a 5xx answer is an error naming the status', async (t) => {
  const { stub, client } = await setup(t);
  stub.outage(1, 503);
  await assert.rejects(client.tool('bakers_ticket_read', { ticket: 'ACME-1' }), /503/);
});

test('a tool refusal is an error carrying the tool message', async (t) => {
  const { client } = await setup(t, {
    tools: {
      bakers_ticket_read: () => {
        throw new Error('Ticket ACME-9 does not exist');
      },
    },
  });
  await assert.rejects(client.tool('bakers_ticket_read', { ticket: 'ACME-9' }), /bakers_ticket_read: Ticket ACME-9 does not exist/);
});
