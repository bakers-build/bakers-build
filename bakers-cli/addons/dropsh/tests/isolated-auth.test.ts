import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createBbConnectionContext, loadBbConfig } from '@bakers-build/core';
import { afterEach, expect, it, vi } from 'vitest';
import { workspaceFixture } from '../../../core/tests/fixtures/workspace-server.js';
import { dispatchBbDropsh } from '../src/index.js';

afterEach(() => vi.unstubAllEnvs());

it('logs in and authenticates requests using the isolated XDG config directory', async () => {
  const f = await workspaceFixture();
  const previousExitCode = process.exitCode;
  try {
    vi.stubEnv('XDG_CONFIG_HOME', join(f.root, 'config'));
    let error = '';
    await dispatchBbDropsh(
      { resolveBases: [] },
      ['auth', 'login', '--provider', 'bakers', '--config', f.config],
      {
        stdout: () => {},
        stderr: (s) => {
          error += s;
        },
      },
    );
    expect(error).toBe('');
    const session = JSON.parse(
      readFileSync(join(f.root, 'config/dropsh/127.0.0.1.json'), 'utf8'),
    );
    expect(session.profiles.bakers.session.access_token).toBe('fixture-token');
    const connection = await loadBbConfig(
      { resolveBases: [] },
      { explicit: f.config },
    );
    const context = await createBbConnectionContext(connection);
    const request = await context.auth.apply({
      method: 'GET',
      url: `${f.base}/jsonapi/bb_workspace/bb_workspace`,
      headers: {},
    });
    await context.http.send(request);
    expect(f.requests.at(-1)).toContain('Bearer fixture-token');
  } finally {
    process.exitCode = previousExitCode;
    await f.close();
  }
});
