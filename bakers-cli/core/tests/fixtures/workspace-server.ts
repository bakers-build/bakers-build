import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHttpClient } from 'dropsh/plugin';

export const firstWorkspace = '11111111-1111-4111-8111-111111111111';
export const secondWorkspace = '22222222-2222-4222-8222-222222222222';
export async function workspaceFixture() {
  const root = mkdtempSync(join(tmpdir(), 'bakers-workspace-'));
  const config = join(root, '.bakers', 'bakers.config.js');
  const stateDir = join(root, 'state');
  mkdirSync(dirname(config));
  const requests: string[] = [];
  const workspaces: (string | undefined)[] = [];
  let status = 200;
  let pages = [
    [{ id: firstWorkspace, name: 'First' }],
    [{ id: secondWorkspace, name: 'Second' }],
  ];
  const server = createServer((req, res) => {
    workspaces.push(req.headers['x-workspace'] as string | undefined);
    requests.push(`${req.method} ${req.url} ${req.headers.authorization}`);
    if (req.url === '/oauth/token') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const p = new URLSearchParams(body);
        if (
          p.get('client_secret') !== 'fixture-secret' ||
          p.get('grant_type') !== 'client_credentials'
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
    if (status !== 200) {
      res.writeHead(status);
      res.end('{}');
      return;
    }
    if (!req.url?.startsWith('/jsonapi/bb_workspace/bb_workspace')) {
      res.writeHead(404);
      res.end('{}');
      return;
    }
    const page = req.url.includes('page=2') ? 1 : 0;
    res.setHeader('Content-Type', 'application/vnd.api+json');
    res.end(
      JSON.stringify({
        data: (pages[page] ?? []).map((w) => ({
          type: 'bb_workspace--bb_workspace',
          id: w.id,
          attributes: { name: w.name },
        })),
        links:
          page === 0 && pages.length > 1
            ? {
                next: {
                  href: `${base}/jsonapi/bb_workspace/bb_workspace?page=2`,
                },
              }
            : {},
      }),
    );
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address();
  const base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  const require = createRequire(new URL('../../package.json', import.meta.url));
  const oauth = require.resolve('@dropsh/plugin-oauth2');
  const plugin = join(root, 'plugin.mjs');
  writeFileSync(
    plugin,
    `export default (o={})=>({id:'selected-'+o.workspace_id,requiredModules:[],async alterRequest(req){return {...req,headers:{...req.headers,'X-Workspace':o.workspace_id??''}}},registerCommands(p){p.command('selected').action(()=>process.stdout.write(o.workspace_id));}});`,
  );
  const plugins = `[{plugin:${JSON.stringify(oauth)},export:'oauth2Plugin',with:{id:'bakers',default:true,type:'oauth2_client_credentials',scope:'bb:session',client_id:'fixture-client',client_secret:'fixture-secret',token_url:'${base}/oauth/token'}},{plugin:${JSON.stringify(plugin)}}]`;
  const source = (workspace = '') =>
    `export default {site:{base_url:'${base}'},workspace_id:${JSON.stringify(workspace)},plugins:${plugins}};`;
  writeFileSync(config, source());
  return {
    root,
    config,
    stateDir,
    requests,
    workspaces,
    base,
    plugins,
    source,
    setStatus: (n: number) => {
      status = n;
    },
    setPages: (p: typeof pages) => {
      pages = p;
    },
    async login() {
      const { oauth2Plugin } = await import(pathToFileURL(oauth).href);
      const { runAuthLogin } = await import(
        pathToFileURL(
          join(dirname(require.resolve('dropsh')), 'commands/auth.js'),
        ).href
      );
      await runAuthLogin(
        { provider: 'bakers' },
        {
          baseUrl: base,
          providers: [
            oauth2Plugin({
              id: 'bakers',
              default: true,
              type: 'oauth2_client_credentials',
              scope: 'bb:session',
              client_id: 'fixture-client',
              client_secret: 'fixture-secret',
              token_url: `${base}/oauth/token`,
            }).authProvider,
          ],
          stateDir,
          http: createHttpClient(),
          now: Date.now,
          isTTY: false,
          stdout: () => {},
          stderr: () => {},
          prompt: async () => {
            throw Error('Unexpected auth prompt');
          },
          openBrowser: async () => {
            throw Error('Unexpected browser');
          },
        },
      );
    },
    async close() {
      await new Promise<void>((r) => server.close(() => r()));
      rmSync(root, { recursive: true, force: true });
    },
  };
}
