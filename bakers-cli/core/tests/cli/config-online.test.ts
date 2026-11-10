import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHttpClient } from 'dropsh/plugin';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { inventoryConfig } from '../../src/cli/config-inventory.js';
import * as online from '../../src/cli/config-online.js';
import { loadBbConnectionBootstrap } from '../../src/cli/load-bakers-config.js';

let root: string;
let home: string;
let cwd: string;
let server: Server;
let requests: string[];
let base: string;
const id = '11111111-1111-4111-8111-111111111111';
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'bakers-config-online-'));
  home = join(root, 'home');
  cwd = join(root, 'project');
  mkdirSync(join(home, '.bakers', 'connections'), { recursive: true });
  mkdirSync(join(cwd, '.bakers'), { recursive: true });
  requests = [];
  server = createServer((req, res) => {
    requests.push(`${req.method} ${req.url} ${req.headers.authorization}`);
    if (req.method === 'POST' && req.url === '/oauth/token') {
      let body = '';
      req.on('data', (chunk) => {
        body += String(chunk);
      });
      req.on('end', () => {
        const params = new URLSearchParams(body);
        if (
          params.get('client_secret') !== 'fixture-secret' ||
          params.get('client_id') !== 'fixture-client' ||
          params.get('grant_type') !== 'client_credentials'
        ) {
          res.writeHead(400);
          res.end('{}');
          return;
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            access_token: 'fixture-token',
            token_type: 'Bearer',
            expires_in: 3600,
          }),
        );
      });
      return;
    }
    if (req.headers.authorization !== 'Bearer fixture-token') {
      res.writeHead(401);
      res.end('{}');
      return;
    }
    if (req.url?.includes('/denied/')) {
      res.writeHead(403);
      res.end('{}');
      return;
    }
    // BB-495: online verification no longer reads a configured workspace
    // resource (workspace_id is optional) — it resolves the authenticated
    // identity instead, via `client.me()`'s root-document read.
    res.setHeader('Content-Type', 'application/vnd.api+json');
    res.end(
      JSON.stringify({
        meta: { links: { me: { meta: { id: 'fixture-user' } } } },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  writeFileSync(
    join(root, 'auth.mjs'),
    `export default () => ({id:'fixture',authProvider:{id:'bakers',default:true,capabilities:{login:false,logout:false,status:true},createAdapter(){return {async apply(req){return {...req,headers:{...req.headers,Authorization:'Bearer fixture-token'}}}}}}});`,
  );
  writeFileSync(
    join(home, '.bakers/machine.config.js'),
    "export default {machine_id:'0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30',label:'operator'};",
  );
  writeFileSync(
    join(cwd, '.bakers/project.config.js'),
    "export default {project:{name:'demo'}};",
  );
});
afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(root, { recursive: true, force: true });
});
function connection(path: string, prefix = '/jsonapi') {
  writeFileSync(
    path,
    `export default {site:{base_url:'${base}',jsonapi_prefix:'${prefix}'},workspace_id:'${id}',plugins:[{plugin:${JSON.stringify(join(root, 'auth.mjs'))}}]};`,
  );
}
it('uses configured auth and reads the authenticated identity for each selected connection', async () => {
  connection(join(home, '.bakers/connections/default.js'));
  connection(join(cwd, '.bakers/connection.config.js'), '/project');
  const report = inventoryConfig({ scope: 'all', home, cwd }).report;
  const result = await online.verifyConfigConnections(report, {
    host: { resolveBases: [] },
    cwd,
    stateDir: join(root, 'state'),
  });
  expect(result.verification.readiness).toBe('ready');
  expect(result.verification.online.connections).toEqual([
    { path: join(home, '.bakers/connections/default.js'), status: 'passed' },
    { path: join(cwd, '.bakers/connection.config.js'), status: 'passed' },
  ]);
  expect(requests).toEqual([
    'GET /jsonapi/ Bearer fixture-token',
    'GET /project/ Bearer fixture-token',
  ]);
});
it('verifies a fresh OAuth connection after login through the real dropsh provider and token endpoint', async () => {
  const requireConductor = createRequire(
    new URL('../../../conductor/package.json', import.meta.url),
  );
  const oauth = requireConductor.resolve('@dropsh/plugin-oauth2');
  const requireCore = createRequire(
    new URL('../../package.json', import.meta.url),
  );
  const dropsh = requireCore.resolve('dropsh');
  const path = join(home, '.bakers/connections/default.js');
  writeFileSync(
    path,
    `export default {schema_version:2,site:{base_url:'${base}',jsonapi_prefix:'/jsonapi'},workspace_id:'${id}',plugins:[{plugin:${JSON.stringify(oauth)},export:'oauth2Plugin',with:{id:'bakers',default:true,type:'oauth2_client_credentials',scope:'bb:session',client_id:'fixture-client',client_secret:'fixture-secret',token_url:'${base}/oauth/token'}}]};`,
  );
  const { runAuthLogin } = await import(
    pathToFileURL(join(dirname(dropsh), 'commands/auth.js')).href
  );
  const bootstrap = await loadBbConnectionBootstrap(
    { resolveBases: [] },
    { explicit: path },
  );
  await runAuthLogin(
    { provider: 'bakers' },
    {
      baseUrl: base,
      providers: bootstrap.plugins.map((p) => p.authProvider).filter(Boolean),
      http: createHttpClient(),
      now: Date.now,
      stateDir: join(root, 'state'),
      isTTY: false,
      stdout: () => {},
      stderr: () => {},
      prompt: async () => {
        throw new Error('Unexpected auth prompt');
      },
      openBrowser: async () => {
        throw new Error('Unexpected browser');
      },
    },
  );
  const report = await online.verifyConfigConnections(
    inventoryConfig({ scope: 'connection', home, cwd }).report,
    { host: { resolveBases: [] }, cwd, stateDir: join(root, 'state') },
  );
  expect(report.verification.readiness).toBe('ready');
  expect(requests).toEqual([
    'POST /oauth/token undefined',
    'GET /jsonapi/ Bearer fixture-token',
  ]);
});
it('attributes denial to the global connection even when project access works', async () => {
  connection(join(home, '.bakers/connections/default.js'), '/denied');
  connection(join(cwd, '.bakers/connection.config.js'));
  const report = await online.verifyConfigConnections(
    inventoryConfig({ scope: 'all', home, cwd }).report,
    { host: { resolveBases: [] }, cwd },
  );
  expect(report.result).toBe('failed');
  expect(report.verification.readiness).toBe('unverified');
  const finding = report.findings.find(
    (f) => f.code === 'authentication_failure',
  );
  expect(finding?.path).toBe(join(home, '.bakers/connections/default.js'));
  expect(finding?.recheck).toContain('--config');
  expect(requests).toHaveLength(2);
});
it('machine scope performs no network request', async () => {
  const report = await online.verifyConfigConnections(
    inventoryConfig({ scope: 'machine', home, cwd }).report,
    { host: { resolveBases: [] }, cwd },
  );
  expect(report.verification.online.status).toBe('not_applicable');
  expect(requests).toEqual([]);
});
it('verifies inherited global connection only once', async () => {
  connection(join(home, '.bakers/connections/default.js'));
  const report = await online.verifyConfigConnections(
    inventoryConfig({ scope: 'all', home, cwd }).report,
    { host: { resolveBases: [] }, cwd },
  );
  expect(report.result).toBe('ok');
  expect(requests).toHaveLength(1);
});
it('establishes online readiness for a computed base_url while reporting it as not checked offline', async () => {
  const path = join(home, '.bakers/connections/default.js');
  connection(path);
  writeFileSync(
    path,
    readFileSync(path, 'utf8').replace(
      `base_url:'${base}'`,
      `base_url:'${base}'.trim()`,
    ),
  );
  const report = await online.verifyConfigConnections(
    inventoryConfig({ scope: 'connection', home, cwd }).report,
    { host: { resolveBases: [] }, cwd },
  );
  // BAKERS-159: a computed value is a `not_checked` warning, which leaves
  // offline validation passed, instead of `unknown_value`/`incomplete`.
  expect(report.findings).toContainEqual(
    expect.objectContaining({
      code: 'not_checked',
      severity: 'warning',
      key: 'site.base_url',
      path,
    }),
  );
  expect(report.verification.offline.status).toBe('passed');
  expect(report.verification.readiness).toBe('ready');
  expect(report.result).toBe('ok');
});

it('identifies every connection request as the bakers CLI with its version', async () => {
  const seen: Array<Record<string, string> | undefined> = [];
  const context = await online.createBbConnectionContext(
    {
      site: {
        base_url: 'http://bakers.test',
        jsonapi_prefix: 'jsonapi',
      } as never,
      plugins: [],
    },
    {
      auth: { apply: async (request) => request },
      http: {
        send: async (request) => {
          seen.push(request.headers);
          return {
            status: 200,
            headers: { 'content-type': 'application/vnd.api+json' },
            body: JSON.stringify({
              meta: { links: { me: { meta: { id: 'u' } } } },
            }),
          };
        },
      },
    },
  );
  await context.client.me();
  await context.http.send({
    method: 'GET',
    url: 'http://bakers.test/_bakers-api/x',
  });
  expect(seen).toHaveLength(2);
  for (const headers of seen)
    expect(headers?.['X-Bakers-Client']).toMatch(/^bakers\/\d+\.\d+\.\d+/);
});
