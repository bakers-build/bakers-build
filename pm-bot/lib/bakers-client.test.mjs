import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBakersClient } from './bakers-client.mjs';
import { bakersStub } from '../test/stubs.mjs';

const ticketPage = { data: [{ id: 't-1', attributes: { identifier: 'ACME-1' } }] };
const jsonapi = (r) => (r.method === 'GET' && r.path === '/jsonapi/bb_ticket/bb_ticket' ? { body: ticketPage } : { status: 404, body: {} });

async function setup(t, options = {}) {
  const stub = await bakersStub({ jsonapi, tools: { bakers_ticket_read: (args) => ({ id: 't-1', identifier: args.ticket }) }, ...options });
  t.after(stub.close);
  let clock = 1_000_000;
  const client = createBakersClient({ url: `${stub.url}/`, clientId: 'key', clientSecret: 'secret', now: () => clock });
  return { stub, client, tick: (seconds) => (clock += seconds * 1000) };
}

const tokenRequests = (stub) => stub.requests.filter((r) => r.path === '/oauth/token');

test('it signs in with client credentials of the API key and the bb:session scope', async (t) => {
  const { stub, client } = await setup(t);
  assert.deepEqual(await client.get('/jsonapi/bb_ticket/bb_ticket'), ticketPage);
  const [token] = tokenRequests(stub);
  assert.deepEqual(Object.fromEntries(new URLSearchParams(token.raw)), {
    grant_type: 'client_credentials',
    client_id: 'key',
    client_secret: 'secret',
    scope: 'bb:session',
  });
});

test('a token is reused until 30 seconds before it expires', async (t) => {
  const { stub, client, tick } = await setup(t);
  await client.get('/jsonapi/bb_ticket/bb_ticket');
  tick(269);
  await client.get('/jsonapi/bb_ticket/bb_ticket');
  assert.equal(tokenRequests(stub).length, 1);
  tick(2);
  await client.get('/jsonapi/bb_ticket/bb_ticket');
  assert.equal(tokenRequests(stub).length, 2);
});

test('a 401 drops the token, fetches a new one and repeats the request once', async (t) => {
  const { stub, client } = await setup(t);
  await client.get('/jsonapi/bb_ticket/bb_ticket');
  stub.revoke();
  assert.deepEqual(await client.get('/jsonapi/bb_ticket/bb_ticket'), ticketPage);
  assert.equal(tokenRequests(stub).length, 2);
});

test('after a refused connection the next call signs in again and succeeds', async (t) => {
  const { stub, client } = await setup(t);
  await client.get('/jsonapi/bb_ticket/bb_ticket');
  await stub.down();
  await assert.rejects(client.get('/jsonapi/bb_ticket/bb_ticket'));
  await stub.up();
  stub.revoke(); // a redeployed site may not know the old token
  assert.deepEqual(await client.get('/jsonapi/bb_ticket/bb_ticket'), ticketPage);
});

test('a 5xx answer is an error naming the status', async (t) => {
  const { stub, client } = await setup(t);
  stub.outage(1, 503);
  await assert.rejects(client.get('/jsonapi/bb_ticket/bb_ticket'), /503/);
});

test('JSON:API PATCH sends the document with the JSON:API media type', async (t) => {
  const seen = [];
  const { client } = await setup(t, {
    jsonapi: (r) => {
      seen.push(r);
      return { body: { data: { id: 't-1' } } };
    },
  });
  const doc = { data: { type: 'bb_ticket--bb_ticket', id: 't-1', attributes: { frozen: false } } };
  assert.deepEqual(await client.patch('/jsonapi/bb_ticket/bb_ticket/t-1', doc), { data: { id: 't-1' } });
  assert.equal(seen[0].method, 'PATCH');
  assert.equal(seen[0].headers['content-type'], 'application/vnd.api+json');
  assert.deepEqual(JSON.parse(seen[0].raw), doc);
});

test('a bakers.build tool is called over /mcp and its JSON result returned', async (t) => {
  const { stub, client } = await setup(t);
  assert.deepEqual(await client.tool('bakers_ticket_read', { ticket: 'ACME-1' }), { id: 't-1', identifier: 'ACME-1' });
  assert.deepEqual(stub.calls('bakers_ticket_read'), [{ ticket: 'ACME-1' }]);
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
