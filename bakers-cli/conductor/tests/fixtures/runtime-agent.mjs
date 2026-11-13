// Deterministic agent process: the conductor, MCP transport and sandbox stay real.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const config = JSON.parse(readFileSync(process.env.FAKE_AGENT_CONFIG, 'utf8'));
assert.equal(process.env.HOME, config.home);
assert.equal(
  existsSync(config.hostSecret),
  false,
  'operator files must be hidden',
);
assert.equal(
  existsSync(`/proc/${config.hostPid}`),
  false,
  'host PID must be hidden',
);
assert.equal(existsSync('/var/run/docker.sock'), false);
assert.equal(
  process.env.UNRELATED_SECRET,
  undefined,
  'ambient executor env must be filtered',
);
assert.equal(process.env.FAKE_MODEL_TOKEN, 'fixture-token');
const client = new Client({ name: 'fake-agent', version: '1.0.0' });
try {
  await client.connect(
    new StreamableHTTPClientTransport(
      new URL(process.env.BAKERS_CONDUCTOR_URL),
      {
        requestInit: {
          headers: {
            authorization: `Bearer ${process.env.BAKERS_CONDUCTOR_TOKEN}`,
          },
        },
      },
    ),
  );
  const result = await client.callTool({
    name: 'bakers_ticket_read',
    arguments: { ticket: process.env.BAKERS_ID },
  });
  assert.notEqual(result.isError, true);
  assert.match(JSON.stringify(result.content), /BB-1/);
  writeFileSync('worked.txt', 'fake agent completed\n');
  execFileSync('git', ['add', 'worked.txt']);
  execFileSync('git', [
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.test',
    'commit',
    '-qm',
    'fake agent completed',
  ]);
  writeFileSync(
    process.env.FAKE_AGENT_TRANSCRIPT,
    JSON.stringify({ ticketRead: true, isolated: true, committed: true }),
  );
} finally {
  await client.close();
}
