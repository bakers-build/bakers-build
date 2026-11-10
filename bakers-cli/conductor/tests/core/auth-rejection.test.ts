import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseClaudeTranscript } from '@bakers-build/addon-claude';
import {
  FakeBbRemote,
  FakeExecutor,
  FakeWorkspace,
  fakeExecutor,
  fakeRemote,
  fakeWorkspace,
} from '@bakers-build/addon-fake';
import type { ConductorFileConfig } from '@bakers-build/conductor/contract';
import type { ConductorLogger } from '@bakers-build/core';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_AGENT_PROMPT } from '../../src/config.js';
import { Conductor, readAuthRejection } from '../../src/core/conductor.js';

const REJECTED =
  "bakers.build rejected the conductor's client credential (Token request failed: invalid_client) — run bakers auth login";

function setup() {
  const logs: { level: string; msg?: string }[] = [];
  const mk = (level: string) => (_obj: object, msg?: string) => {
    logs.push({ level, msg });
  };
  const log: ConductorLogger = {
    debug: mk('debug'),
    info: mk('info'),
    warn: mk('warn'),
    error: mk('error'),
  };
  const remote = new FakeBbRemote({
    tickets: { 't-1': { identifier: 'BB-1', title: 'One', state: 'todo' } },
  });
  remote.queue.push({
    runUuid: 'r-1',
    runId: 1,
    ticketUuid: 't-1',
    stateAtStart: 'todo',
    handler: 'code',
  });
  const config: ConductorFileConfig = {
    site: { base_url: 'http://web', jsonapi_prefix: '/jsonapi' },
    remote: fakeRemote(),
    executor: fakeExecutor(),
    agent: [],
    workspace: fakeWorkspace(),
    label: 'test',
    conductor_id: 'bakers-test-conductor',
    project: 'bakers',
    states: ['todo'],
    prompt: DEFAULT_AGENT_PROMPT,
    host_key: 'test-box',
    poll_interval_ms: 1,
    lease_seconds: 300,
    config_path: '/tmp/bakers-auth-test/conductor.config.js',
  };
  const conductor = new Conductor(
    config,
    remote,
    new FakeExecutor({ outcome: 'exited' }),
    new FakeWorkspace(),
    [
      {
        id: 'claude',
        agent: {
          id: 'claude',
          launchCommand: () => 'claude',
          getRunLog: async () => '',
          parseFootprint: parseClaudeTranscript,
        },
      },
    ],
    log,
    tmpdir(),
  );
  const file = join(
    mkdtempSync(join(tmpdir(), 'auth-')),
    'conductor.auth.json',
  );
  conductor.authStatusFile = file;
  return { conductor, remote, logs, file };
}

describe('rejected bakers.build credential', () => {
  it('stops claiming, names the credential, writes the status file and backs off; recovers when accepted again', async () => {
    const { conductor, remote, logs, file } = setup();
    await conductor.start();
    const heartbeat = remote.heartbeat.bind(remote);
    let calls = 0;
    let rejected = true;
    remote.heartbeat = async (...args) => {
      calls += 1;
      if (rejected) {
        throw Object.assign(new Error('Token request failed: invalid_client'), {
          name: 'AuthError',
        });
      }
      return heartbeat(...args);
    };
    conductor.authBackoffMs = 300;
    const ctrl = new AbortController();
    const served = conductor.serve(ctrl.signal);
    await vi.waitFor(() => expect(existsSync(file)).toBe(true));
    expect(readAuthRejection(file)).toBe(REJECTED);
    expect(logs).toContainEqual({ level: 'error', msg: REJECTED });
    expect(remote.queue).toHaveLength(1); // nothing claimed
    await new Promise((r) => setTimeout(r, 15));
    expect(calls).toBe(1); // backed off instead of polling every 1 ms

    rejected = false;
    await vi.waitFor(() => expect(existsSync(file)).toBe(false));
    expect(readAuthRejection(file)).toBeUndefined();
    ctrl.abort();
    await served;
  });

  it('treats an HTTP 401 like a rejected token', async () => {
    const { conductor, remote, file } = setup();
    await conductor.start();
    remote.heartbeat = async () => {
      throw Object.assign(new Error('HTTP 401 Unauthorized'), {
        name: 'HttpError',
        status: 401,
      });
    };
    const ctrl = new AbortController();
    const served = conductor.serve(ctrl.signal);
    await vi.waitFor(() => expect(existsSync(file)).toBe(true));
    expect(readAuthRejection(file)).toBe(
      "bakers.build rejected the conductor's client credential (HTTP 401 Unauthorized) — run bakers auth login",
    );
    ctrl.abort();
    await served;
  });
});
