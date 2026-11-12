import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const cliRoot = join(here, '..', '..');
const bakersBin = join(cliRoot, 'bin', 'bakers');
const renderer = join(here, 'fixtures', 'pty-renderer.mjs');
const basicAuthModule = join(
  cliRoot,
  'addons',
  'auth-basic',
  'dist',
  'src',
  'index.js',
);

describe('bakers ui live PTY update notice', () => {
  const servers: ReturnType<typeof createServer>[] = [];
  afterEach(async () => {
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
    );
  });

  it('prints the cached update before the renderer takes the terminal', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/vnd.api+json' });
      response.end(
        JSON.stringify({
          jsonapi: { version: '1.0' },
          links: { self: '/jsonapi/bb_project/bb_project' },
          data: [],
        }),
      );
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('missing test server address');

    const home = await mkdtemp(join(tmpdir(), 'bakers-ui-pty-'));
    const bakersDir = join(home, '.bakers');
    await mkdir(join(bakersDir, 'connections'), { recursive: true });
    const config = join(bakersDir, 'connections', 'default.js');
    await writeFile(
      config,
      `import { basicAuthProvider } from '${pathToFileURL(basicAuthModule).href}';\n` +
        `export default { site: { base_url: 'http://127.0.0.1:${address.port}', jsonapi_prefix: '/jsonapi' }, workspace_id: '00000000-0000-4000-8000-000000000000', plugins: [basicAuthProvider('dGVzdDp0ZXN0')] };\n`,
    );
    await writeFile(
      join(bakersDir, 'update-check.json'),
      JSON.stringify({
        checkedAt: new Date().toISOString(),
        latestVersion: '9.0.0',
      }),
    );

    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        'script',
        [
          '-qec',
          `${bakersBin} ui --workspace 00000000-0000-4000-8000-000000000000`,
          '/dev/null',
        ],
        {
          cwd: cliRoot,
          env: {
            ...process.env,
            HOME: home,
            BAKERS_CONFIG: config,
            DROPSH_CONFIG: config,
            BB_UI_PLUGIN: renderer,
            // BB-391 (AC2): NO `$DROPSH_AUTH_PROFILE`. This used to pin
            // `basic_auth` because the launcher exported the connection's
            // `authProfile` and a stale value could win; both are gone, and the
            // sole provider a connection declares now resolves on its own. Keeping
            // the pin here would hide a launcher that had started setting it again.
          },
        },
      );
      let text = '';
      child.stdout.on('data', (chunk) => {
        text += String(chunk);
      });
      child.stderr.on('data', (chunk) => {
        text += String(chunk);
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve(text);
        else reject(new Error(`PTY command exited ${code}: ${text}`));
      });
    });

    const notice = output.indexOf('A new bakers version is available');
    const marker = output.indexOf('BB_UI_RENDERER_MARKER');
    expect(notice).toBeGreaterThanOrEqual(0);
    expect(marker).toBeGreaterThan(notice);
  }, 10_000);
});
