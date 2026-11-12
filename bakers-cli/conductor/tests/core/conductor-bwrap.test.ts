import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FakeBbRemote,
  fakeExecutor,
  fakeRemote,
  fakeWorkspace,
} from '@bakers-build/addon-fake';
import {
  type BbAgent,
  type BbExecutor,
  type ConductorFileConfig,
  emptyAgentFootprint,
} from '@bakers-build/conductor/contract';
import { shellQuote } from '@bakers-build/core';
import { expect, it } from 'vitest';
import { bwrapRuntime } from '../../../addons/runtime-bwrap/src/backend.js';
import { TestConductor } from '../test-conductor.js';

const probe = spawnSync(
  'bwrap',
  [
    '--unshare-user',
    '--unshare-pid',
    '--ro-bind',
    '/',
    '/',
    '--proc',
    '/proc',
    '--',
    '/bin/true',
  ],
  { encoding: 'utf8' },
);
const available = process.platform === 'linux' && probe.status === 0;
if (process.env.BAKERS_TEST_BWRAP_REQUIRED === '1' && !available)
  throw new Error(
    `Bubblewrap must run in this CI job: ${probe.error?.message ?? probe.stderr}`,
  );

it.skipIf(!available)(
  'runs a fake agent through conductor, real Bubblewrap and MCP, then captures and cleans the run',
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'bb-conductor-bwrap-'));
    const main = join(root, 'main'),
      ws = join(root, 'tree'),
      hostHome = join(root, 'operator'),
      transcripts = join(root, 'transcripts');
    const cliRoot = fileURLToPath(new URL('../../../', import.meta.url));
    const fixture = fileURLToPath(
      new URL('../fixtures/runtime-agent.mjs', import.meta.url),
    );
    const uuid = randomUUID();
    const transcript = join(transcripts, `${uuid}.json`);
    const hostSecret = join(hostHome, '.ssh/key');
    const git = (...args: string[]) =>
      execFileSync('git', args, {
        cwd: main,
        encoding: 'utf8',
        stdio: 'pipe',
      }).trim();
    for (const path of [main, dirname(hostSecret), transcripts])
      mkdirSync(path, { recursive: true });
    writeFileSync(hostSecret, 'operator secret');
    git('init', '-q');
    git(
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.test',
      'commit',
      '--allow-empty',
      '-qm',
      'base',
    );
    git('worktree', 'add', '-q', ws, '-b', 'agent-run');
    const runtime = bwrapRuntime(
      {},
      {
        cachePath: join(root, 'runtime'),
        cliRoot,
        env: { HOME: hostHome, PATH: process.env.PATH },
      },
    );
    let launchEnv: Record<string, string> = {};
    const executor: BbExecutor = {
      id: 'process',
      capabilities: () => ({ persistent: true }),
      async startRun(input) {
        launchEnv = input.env;
        await new Promise<void>((resolve, reject) => {
          const child = spawn('sh', ['-c', input.command], {
            cwd: input.workspacePath,
            env: {
              ...process.env,
              ...input.env,
              UNRELATED_SECRET: 'ambient-secret',
            },
            stdio: ['ignore', 'ignore', 'pipe'],
          });
          let stderr = '';
          child.stderr.on('data', (data) => {
            stderr += data;
          });
          child.once('error', reject);
          child.once('exit', (code) =>
            code === 0
              ? resolve()
              : reject(new Error(`fake agent exited ${code}: ${stderr}`)),
          );
        });
        return { sessionRef: input.ticket.branchName };
      },
      async stopRun() {},
      async cleanupRun() {},
    };
    const projectId = '11111111-1111-4111-8111-111111111111';
    const remote = new FakeBbRemote({
      runs: [
        {
          runUuid: uuid,
          id: 1,
          ticketUuid: 'ticket-1',
          stateAtStart: 'working',
          state: 'claimed',
        },
      ],
      tickets: {
        'ticket-1': {
          identifier: 'BB-1',
          title: 'Isolated fake agent',
          state: 'working',
          branchName: 'agent-run',
          projectId,
        },
      },
    });
    const calls: string[] = [];
    remote.siteTools = {
      list: async () => [
        {
          name: 'tool_api__bakers_ticket_read',
          inputSchema: {
            type: 'object',
            properties: { ticket: { type: 'string' } },
            required: ['ticket'],
          },
        },
      ],
      call: async (name, args) => {
        calls.push(name);
        expect(args.ticket).toBe('ticket-1');
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ identifier: 'BB-1', project: projectId }),
            },
          ],
        };
      },
      async close() {},
    };
    const agent: BbAgent = {
      id: 'fake-agent',
      runEnvPolicy: { drop: true, deny: [] },
      prepareRun: (context) => {
        const path = join(context.homePath, 'agent.json');
        writeFileSync(
          path,
          JSON.stringify({
            home: context.homePath,
            hostSecret,
            hostPid: process.pid,
          }),
        );
        return {
          env: {
            FAKE_AGENT_CONFIG: path,
            FAKE_AGENT_TRANSCRIPT: transcript,
            FAKE_MODEL_TOKEN: 'fixture-token',
          },
          readPaths: [],
          writePaths: [transcripts],
        };
      },
      launchCommand: () =>
        [process.execPath, fixture].map(shellQuote).join(' '),
      getRunLog: async () => readFileSync(transcript, 'utf8'),
      parseFootprint: () => ({ ...emptyAgentFootprint(), tool_calls: 1 }),
    };
    const log = { debug() {}, info() {}, warn() {}, error() {} };
    const config = {
      site: { base_url: 'http://fixture.invalid', jsonapi_prefix: '/jsonapi' },
      remote: fakeRemote(),
      executor: fakeExecutor(),
      workspace: fakeWorkspace(),
      label: 'fixture',
      conductor_id: 'test-bwrap',
      project: 'fixture',
      states: ['working'],
      prompt: 'fixture',
      host_key: 'fixture',
      poll_interval_ms: 5000,
      lease_seconds: 300,
      config_path: join(main, 'project.config.js'),
      marketplaces: [],
      runtime: {
        kind: 'runtime',
        id: 'bwrap',
        isolates: true,
        requiredModules: [],
        createRuntime: async () => runtime,
      },
    } as ConductorFileConfig;
    const conductor = new TestConductor(
      config,
      remote,
      executor,
      {
        ensure: async () => ({ path: ws, instructions: null, created: false }),
      },
      [{ id: 'fake-agent', permissions: 'yolo', agent }],
      log,
      main,
    );
    try {
      await conductor.startTools();
      await conductor.start();
      await conductor.tick();
      expect(remote.calls.markFailed).toEqual([]);
      expect(JSON.parse(readFileSync(transcript, 'utf8'))).toEqual({
        ticketRead: true,
        isolated: true,
        committed: true,
      });
      expect(calls).toContain('tool_api__bakers_ticket_read');
      expect(git('-C', ws, 'log', '-1', '--format=%s')).toBe(
        'fake agent completed',
      );
      expect(existsSync(join(root, 'runtime', uuid))).toBe(true);
      remote.setRunLogStorageAllowed(uuid, true);
      remote.markDone(uuid);
      await conductor.tick();
      expect(remote.calls.finalizeRun).toHaveLength(1);
      expect(remote.calls.finalizeRun[0]).toMatchObject({
        runUuid: uuid,
        log: readFileSync(transcript, 'utf8'),
        metrics: { harness: 'fake-agent', tool_calls: 1 },
      });
      for (const suffix of ['', '.launch.json', '.launch.json.pid'])
        expect(existsSync(join(root, 'runtime', uuid) + suffix)).toBe(false);
      const response = await fetch(launchEnv.BAKERS_CONDUCTOR_URL!, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${launchEnv.BAKERS_CONDUCTOR_TOKEN}`,
        },
      });
      expect(response.status).toBe(401);
    } finally {
      await conductor.stopTools();
      await runtime.cleanup({ uuid, id: 1 });
      rmSync(root, { recursive: true, force: true });
    }
  },
  20000,
);
