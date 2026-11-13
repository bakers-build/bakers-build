// Deterministic agent process: the conductor, MCP transport and sandbox stay real.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
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
  // The parent repository is not in the sandbox; the host transfers at run end.
  assert.equal(existsSync(config.parentGit), false);
  // Every way a run could reach the parent's Git data or the protected directory must fail.
  const sh = (command) =>
    spawnSync('sh', ['-c', command], { encoding: 'utf8' }).status;
  for (const attack of [
    `git --git-dir='${config.parentGit}' update-ref refs/heads/agent-run HEAD`,
    'echo probe > .bakers/probe',
    'echo probe >> .bakers/keep',
    'mv .bakers/keep .bakers/keep.moved',
    'rm .bakers/keep',
    'mv .bakers .bakers-moved',
    'rm -rf .bakers',
  ])
    assert.notEqual(sh(attack), 0, `attack succeeded: ${attack}`);
  assert.equal(existsSync('.bakers/keep'), true);
  // A write at the parent's path lands at most in the sandbox's own /tmp; the host test checks the real one.
  sh(
    `mkdir -p '${config.parentGit}' && echo probe > '${config.parentGit}/probe'`,
  );
  // The run's own clone stays fully usable, and its ref games stay in the clone.
  assert.equal(sh('git status --short && git log --oneline -1'), 0);
  assert.equal(sh('git update-ref refs/heads/main HEAD'), 0);
  writeFileSync(
    process.env.FAKE_AGENT_TRANSCRIPT,
    JSON.stringify({
      ticketRead: true,
      isolated: true,
      committed: true,
    }),
  );
} finally {
  await client.close();
}
