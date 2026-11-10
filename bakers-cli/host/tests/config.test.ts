import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, expect, it } from 'vitest';
import * as config from '../src/config.js';
import { buildHostProgram } from '../src/host.js';

let root: string;
let home: string;
let cwd: string;
const workspace = '11111111-1111-4111-8111-111111111111';
const savedCode = process.exitCode;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bakers-config-command-'));
  home = join(root, 'home');
  cwd = join(root, 'project');
  mkdirSync(home);
  mkdirSync(cwd);
  process.exitCode = 0;
});
afterEach(() => {
  process.exitCode = savedCode;
  rmSync(root, { recursive: true, force: true });
});
async function run(args: string[], extra = {}) {
  let output = '';
  const program = new Command().exitOverride();
  config.registerConfig(program, {
    cwd,
    home,
    stateDir: join(home, '.config/dropsh'),
    isTTY: false,
    env: {},
    stdout: (s: string) => {
      output += s;
    },
    ...extra,
  });
  await program.parseAsync(['config', ...args], { from: 'user' });
  try {
    return JSON.parse(output);
  } catch {
    // --format text, or a caller-supplied stdout sink that discards output
    // (as the sign-in interview test does to observe prompts instead of the
    // report), leaves nothing here to parse as JSON.
    return output;
  }
}
function seed() {
  mkdirSync(join(home, '.bakers/connections'), { recursive: true });
  writeFileSync(
    join(home, '.bakers/machine.config.js'),
    "export default {schema_version:1,machine_id:'0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30',label:'operator'};",
  );
  writeFileSync(
    join(home, '.bakers/connections/default.js'),
    `export default {schema_version:1,site:{base_url:'https://example.test'},workspace_id:'${workspace}',plugins:[]};`,
  );
}
it('checks a named connection with id, selector and field provenance', async () => {
  seed();
  const path = join(home, '.bakers/connections/staging.js');
  writeFileSync(
    path,
    "export default {schema_version:1,site:{base_url:'https://staging.test'},plugins:[{plugin:'@bakers-build/addon-essentials'}]};",
  );
  const report = await run([
    'check',
    '--scope',
    'connection',
    '--connection',
    'staging',
    '--format',
    'json',
  ]);
  expect(report.connection_resolution).toMatchObject({
    id: 'staging',
    selected_by: 'flag-connection',
    path,
  });
  expect(report.connection_resolution.fields).toContainEqual({
    key: 'site.base_url',
    value: 'https://staging.test',
    source: path,
  });
  expect(report.connection_resolution.fields).toEqual(
    expect.arrayContaining([
      { key: 'schema_version', value: 1, source: path },
      { key: 'site.base_url', value: 'https://staging.test', source: path },
      {
        key: 'site.jsonapi_prefix',
        value: '/jsonapi',
        source: 'built-in default',
      },
      {
        key: 'plugins[0].plugin',
        value: '@bakers-build/addon-essentials',
        source: path,
      },
    ]),
  );
});
it('reports the computed effective JSON:API prefix without inventing a default', async () => {
  seed();
  const path = join(home, '.bakers/connections/default.js');
  writeFileSync(
    path,
    `const prefix = '/custom'; export default { schema_version: 1, site: { base_url: 'https://example.test', jsonapi_prefix: prefix }, plugins: [] };`,
  );
  const report = await run([
    'check',
    '--scope',
    'connection',
    '--format',
    'json',
  ]);
  expect(report.connection_resolution.fields).toContainEqual({
    key: 'site.jsonapi_prefix',
    value: '/custom',
    source: 'dynamic/not statically determined',
  });
  expect(report.connection_resolution.fields).not.toContainEqual(
    expect.objectContaining({ key: 'site.jsonapi_prefix', value: '/jsonapi' }),
  );
});
it('requires explicit noninteractive init scope and reports all canonical choices', async () => {
  const report = await run(['init', '--format', 'json']);
  expect(report.findings[0].code).toBe('scope_required');
  expect(report.findings[0].remediation).toContain(
    'bakers config init --scope connection',
  );
  expect(process.exitCode).toBe(1);
  expect(existsSync(join(home, '.bakers'))).toBe(false);
});
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
async function machineFile() {
  const path = join(home, '.bakers/machine.config.js');
  return (await import(`${path}?t=${Date.now()}-${Math.random()}`)).default;
}
it('initializes machine only with a generated UUID and the given label, and keeps both on a re-run', async () => {
  const args = ['init', '--scope', 'machine', '--format', 'json'];
  const first = await run([...args, '--label', 'cw-laptop']);
  expect(first.result).toBe('ok');
  expect(first.verification.online.status).toBe('not_applicable');
  expect(existsSync(join(home, '.bakers/connections/default.js'))).toBe(false);
  const machine = await machineFile();
  expect(machine.machine_id).toMatch(UUID_V4);
  expect(machine.label).toBe('cw-laptop');
  expect(machine).not.toHaveProperty('user_id');
  const before = readFileSync(join(home, '.bakers/machine.config.js'), 'utf8');
  const second = await run([...args, '--label', 'other']);
  expect(second.changes).toEqual([]);
  expect(readFileSync(join(home, '.bakers/machine.config.js'), 'utf8')).toBe(
    before,
  );
});
it('rewrites an existing machine file in place, keeping its machine_id', async () => {
  mkdirSync(join(home, '.bakers'), { recursive: true });
  writeFileSync(
    join(home, '.bakers/machine.config.js'),
    "// @bakers-schema-version 3\nexport default { schema_version: 3, machine_id: 'framework', user_id: 'cw' };\n",
  );
  const args = ['init', '--scope', 'machine', '--format', 'json'];
  const report = await run([...args, '--label', 'cw-laptop']);
  expect(report.result).toBe('ok');
  const machine = await machineFile();
  expect(machine.machine_id).toBe('framework');
  expect(machine.label).toBe('cw-laptop');
  expect(machine.schema_version).toBe(1);
  expect(machine).not.toHaveProperty('user_id');
  expect((await run(args)).changes).toEqual([]);
});
it('labels the machine with the short hostname when no terminal can ask', async () => {
  const report = await run(['init', '--scope', 'machine', '--format', 'json']);
  expect(report.result).toBe('ok');
  const machine = await machineFile();
  expect(machine.machine_id).toMatch(UUID_V4);
  expect(machine.label).toBe(hostname().split('.')[0]);
});
it.each([
  '--machine-id',
  '--user-id',
])('no longer accepts the hand-chosen identity flag %s', async (flag) => {
  const program = new Command().exitOverride();
  program.configureOutput({ writeErr: () => {} });
  config.registerConfig(program, { cwd, home, isTTY: false });
  await expect(
    program.parseAsync(['config', 'init', '--scope', 'machine', flag, 'x'], {
      from: 'user',
    }),
  ).rejects.toMatchObject({ code: 'commander.unknownOption' });
  expect(existsSync(join(home, '.bakers'))).toBe(false);
});
it.each([
  'user',
  'bogus',
])('rejects unsupported scope %s without writes', async (scope) => {
  expect(
    (await run(['init', '--scope', scope, '--format', 'json'])).findings[0]
      .code,
  ).toBe('invalid_scope');
});
it('check defaults to machine and connection outside a project and never imports source', async () => {
  seed();
  const marker = join(root, 'executed');
  writeFileSync(
    join(home, '.bakers/connections/default.js'),
    `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},'bad'); export default {site:};`,
  );
  const report = await run(['check', '--format', 'json']);
  expect(report.resolved_scopes).toEqual(['machine', 'connection']);
  expect(
    report.findings.some((f: { code: string }) => f.code === 'syntax_error'),
  ).toBe(true);
  expect(existsSync(marker)).toBe(false);
});
it('explains why a requested online check is skipped when offline errors block loading', async () => {
  seed();
  writeFileSync(
    join(home, '.bakers/connections/default.js'),
    'export default {site:};',
  );
  const report = await run([
    'check',
    '--scope',
    'connection',
    '--online',
    '--format',
    'json',
  ]);
  expect(report.result).toBe('blocked');
  expect(report.verification.online.reason).toContain('offline errors');
  expect(
    report.verification.skipped.some(
      (entry: { stage: string }) => entry.stage === 'online',
    ),
  ).toBe(true);
});
it('dry-run prepares redacted connection changes without importing or writing', async () => {
  const report = await run(
    [
      'init',
      '--scope',
      'connection',
      '--base-url',
      'https://example.test',
      '--client-id',
      'client',
      '--workspace-id',
      workspace,
      '--secret-env',
      'TEST_SECRET',
      '--format',
      'json',
      '--dry-run',
    ],
    { env: { TEST_SECRET: 'private-input' } },
  );
  expect(report.changes).toHaveLength(1);
  expect(JSON.stringify(report)).not.toContain('private-input');
  expect(existsSync(join(home, '.bakers'))).toBe(false);
  expect(report.verification.readiness).toBe('unverified');
});
it('project initialization uses explicit path while shared prerequisites remain byte-identical', async () => {
  seed();
  const target = join(root, 'target');
  mkdirSync(target);
  const machine = readFileSync(join(home, '.bakers/machine.config.js'), 'utf8');
  const connection = readFileSync(
    join(home, '.bakers/connections/default.js'),
    'utf8',
  );
  const report = await run([
    'init',
    '--scope',
    'project',
    '--project',
    'demo',
    '--workspace',
    'Engineering',
    '--path',
    target,
    '--format',
    'json',
    '--dry-run',
  ]);
  expect(report.result).toBe('ok');
  expect(
    report.changes.some(
      (c: { path: string }) =>
        c.path === join(target, '.bakers/project.config.js'),
    ),
  ).toBe(true);
  expect(readFileSync(join(home, '.bakers/machine.config.js'), 'utf8')).toBe(
    machine,
  );
  expect(
    readFileSync(join(home, '.bakers/connections/default.js'), 'utf8'),
  ).toBe(connection);
});
it.each([
  { yes: true },
  { env: { CI: 'true' } },
  { format: 'json' },
])('suppresses prompts in automation %j', async (mode) => {
  let output = '';
  const program = new Command().exitOverride();
  config.registerConfig(program, {
    cwd,
    home,
    stateDir: join(home, '.config/dropsh'),
    isTTY: true,
    env: {},
    ...mode,
    stdout: (text) => {
      output += text;
    },
    prompt: async () => {
      throw new Error('prompted');
    },
  });
  await program.parseAsync(
    [
      'config',
      'init',
      '--format',
      mode.format ?? 'text',
      ...(mode.yes ? ['--yes'] : []),
    ],
    { from: 'user' },
  );
  expect(output).toContain('scope_required');
  expect(output).not.toContain('cancelled_selection');
});
it.each([
  {
    name: 'init with unresolved scope',
    args: ['init', '--dry-run'],
    prepare: () => {},
    expected: 'scope_required',
  },
  {
    // The machine has no input left to ask for (its label defaults to the
    // hostname); the retired user_id is planned away instead.
    name: 'upgrade with a stale machine identity',
    args: ['upgrade', '--scope', 'machine', '--dry-run'],
    prepare: () => {
      mkdirSync(join(home, '.bakers'));
      writeFileSync(
        join(home, '.bakers/machine.config.js'),
        `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(join(root, 'preview-imported'))}, 'unexpected'); export default {machine_id:'host', user_id:'cw'};`,
      );
    },
    expected: 'user_id',
  },
])('preview never prompts at the command boundary: $name', async (row) => {
  row.prepare();
  let output = '';
  let prompts = 0;
  const program = new Command().exitOverride();
  config.registerConfig(program, {
    cwd,
    home,
    stateDir: join(home, '.config/dropsh'),
    isTTY: true,
    env: {},
    stdout: (text) => {
      output += text;
    },
    prompt: async () => {
      prompts++;
      return 'unexpected';
    },
  });

  await program.parseAsync(['config', ...row.args], { from: 'user' });

  expect(prompts).toBe(0);
  expect(output).toContain(row.expected);
  expect(existsSync(join(root, 'preview-imported'))).toBe(false);
  if (row.name.startsWith('init'))
    expect(existsSync(join(home, '.bakers'))).toBe(false);
});
it('host exposes config help and removes top-level upgrade, keeping init as the sign-in shortcut', async () => {
  const program = await buildHostProgram(['config', '--help']);
  const configCommand = program.commands.find((c) => c.name() === 'config');
  expect(configCommand?.helpInformation()).toMatch(
    /init[\s\S]*upgrade[\s\S]*check/,
  );
  const host = await buildHostProgram(['upgrade']);
  host.configureOutput({ writeErr: () => {} });
  await expect(
    host.parseAsync(['upgrade'], { from: 'user' }),
  ).rejects.toMatchObject({ code: 'commander.unknownCommand' });
});
it('bakers init sets up machine identity and the connection, with no visible --scope default', async () => {
  const program = await buildHostProgram(['init', '--help']);
  const initCommand = program.commands.find((c) => c.name() === 'init');
  expect(initCommand?.description()).toContain('machine identity');
  expect(initCommand?.description()).toContain('connection');
  expect(initCommand?.helpInformation()).not.toContain('default: "all"');
});
it('bakers init is not blocked by the project layer inside a project checkout', async () => {
  mkdirSync(join(cwd, '.bakers'));
  writeFileSync(
    join(cwd, '.bakers/project.config.js'),
    "export default {schema_version:1,server:{command:'true'}};",
  );
  let output = '';
  const program = new Command().exitOverride();
  config.registerConfig(program, {
    cwd,
    home,
    isTTY: false,
    env: {},
    stdout: (s: string) => {
      output += s;
    },
  });
  await program.parseAsync(
    [
      'init',
      '--yes',
      '--format',
      'json',
      '--base-url',
      'https://example.test',
      '--client-id',
      'bakers-cli',
      '--workspace-id',
      workspace,
      '--label',
      'operator',
    ],
    { from: 'user' },
  );
  const report = JSON.parse(output);
  expect(report.result).not.toBe('blocked');
  expect(
    report.findings.filter(
      (f: { code: string }) => f.code === 'project_required',
    ),
  ).toEqual([]);
  expect(existsSync(join(home, '.bakers/connections/default.js'))).toBe(true);
});
it('rejects raw secret flags and retires project connection creation before writes', async () => {
  for (const row of [
    { flags: ['--secret', 'private-argument'], message: undefined },
    {
      flags: ['--project-connection', 'create'],
      message: /--project-connection is retired; use --connection/,
    },
  ]) {
    const program = new Command().exitOverride();
    program.configureOutput({ writeErr: () => {} });
    config.registerConfig(program, { cwd, home, isTTY: false });
    await expect(
      program.parseAsync(
        ['config', 'init', '--scope', 'connection', ...row.flags],
        { from: 'user' },
      ),
    ).rejects.toSatisfy((error: unknown) =>
      row.message
        ? error instanceof Error && row.message.test(error.message)
        : typeof error === 'object' &&
          error !== null &&
          'exitCode' in error &&
          error.exitCode === 1,
    );
    expect(existsSync(join(home, '.bakers'))).toBe(false);
  }
});
it('upgrade migrates applicable shared files and reports offline success without readiness claims', async () => {
  seed();
  const machine = join(home, '.bakers/machine.config.js');
  const connection = join(home, '.bakers/connections/default.js');
  writeFileSync(
    machine,
    "export default {machine_id:'0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30',label:'operator'};",
  );
  writeFileSync(
    connection,
    readFileSync(connection, 'utf8').replace(
      'schema_version:4',
      'schema_version:3',
    ),
  );
  const report = await run(['upgrade', '--format', 'json']);
  expect(report.result).toBe('ok');
  expect(report.resolved_scopes).toEqual(['machine', 'connection']);
  expect(report.changes).toHaveLength(2);
  expect(report.verification.online.status).toBe('pending');
  expect(report.verification.readiness).toBe('unverified');
  expect((await run(['upgrade', '--format', 'json'])).changes).toEqual([]);
});
it('a prepared connection with no authenticated session is incomplete with current file fingerprints', async () => {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    response.writeHead(401, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'invalid_client' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    const report = await run(
      [
        'init',
        '--scope',
        'connection',
        '--base-url',
        baseUrl,
        '--client-id',
        'client',
        '--workspace-id',
        workspace,
        '--secret-env',
        'TEST_SECRET',
        '--format',
        'json',
      ],
      { env: { TEST_SECRET: 'private-input' } },
    );
    expect(report.result).toBe('failed');
    expect(report.verification.readiness).toBe('unverified');
    const file = report.files.find(
      (f: { kind: string }) => f.kind === 'connection',
    );
    expect(file.state).toBe('valid');
    expect(file.fingerprint).toMatch(/^sha256:/);
    expect(
      report.findings.find(
        (f: { code: string }) => f.code === 'authentication_failure',
      ).remediation,
      // No `--provider`: dropsh falls back to the connection's `default: true`
      // profile, and naming one here would be wrong for a connection whose
      // provider is not called `bakers`.
    ).toMatch(/auth login(?! --provider)/);
    expect(existsSync(join(home, '.bakers/connections/default.js'))).toBe(true);
    expect(existsSync(join(home, '.bakers/machine.config.js'))).toBe(false);
    expect(JSON.stringify(report)).not.toContain('private-input');
    expect(requests).toEqual(['POST /oauth/token']);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
it('interactive initialization asks for the selected scope and the machine label only', async () => {
  let output = '';
  const questions: string[] = [];
  const answers = ['machine', 'selected-host'];
  const program = new Command().exitOverride();
  config.registerConfig(program, {
    cwd,
    home,
    isTTY: true,
    env: {},
    stdout: (s) => {
      output += s;
    },
    prompt: async (label) => {
      questions.push(label);
      return answers.shift() ?? '';
    },
  });
  await program.parseAsync(['config', 'init'], { from: 'user' });
  expect(output).toContain('bakers config init: ok');
  expect(questions).toEqual([
    'Configuration scope (machine, connection, project, all)',
    `Machine label [${hostname().split('.')[0]}]`,
  ]);
  const machine = await machineFile();
  expect(machine.label).toBe('selected-host');
  expect(machine.machine_id).toMatch(UUID_V4);
  expect(existsSync(join(home, '.bakers/connections/default.js'))).toBe(false);
});
it('fresh interactive connection initialization collects OAuth inputs and verifies them', async () => {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    if (request.method === 'POST' && request.url === '/oauth/token') {
      let body = '';
      request.on('data', (chunk) => {
        body += String(chunk);
      });
      request.on('end', () => {
        const values = new URLSearchParams(body);
        if (
          values.get('client_id') !== 'fixture-client' ||
          values.get('client_secret') !== 'fixture-secret'
        ) {
          response.writeHead(400).end('{}');
          return;
        }
        response.setHeader('Content-Type', 'application/json');
        response.end(
          JSON.stringify({
            access_token: 'fixture-token',
            token_type: 'Bearer',
            expires_in: 3600,
          }),
        );
      });
      return;
    }
    if (request.headers.authorization !== 'Bearer fixture-token') {
      response.writeHead(401).end('{}');
      return;
    }
    // BB-495: online verification reads the authenticated identity via
    // `client.me()`'s root-document read, not a configured workspace resource.
    response.setHeader('Content-Type', 'application/vnd.api+json');
    response.end(
      JSON.stringify({
        meta: { links: { me: { meta: { id: 'fixture-user' } } } },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    const questions: Array<{ label: string; secret: boolean }> = [];
    const answers = [baseUrl, 'fixture-client', 'fixture-secret'];
    let output = '';
    const program = new Command().exitOverride();
    config.registerConfig(program, {
      cwd,
      home,
      stateDir: join(home, '.config/dropsh'),
      isTTY: true,
      env: {},
      stdout: (text) => {
        output += text;
      },
      prompt: async (label, secret = false) => {
        questions.push({ label, secret });
        return answers.shift() ?? '';
      },
    });

    await program.parseAsync(
      [
        'config',
        'init',
        '--scope',
        'connection',
        '--auth-type',
        'client_credentials',
      ],
      { from: 'user' },
    );

    expect(output).toContain('bakers config init: ok');
    expect(output).toContain('Online: passed');
    expect(questions).toEqual([
      { label: 'Server base URL [https://app.bakers.build]', secret: false },
      { label: 'OAuth client identifier', secret: false },
      { label: 'OAuth client secret', secret: true },
    ]);
    expect(
      readFileSync(join(home, '.bakers/connections/default.js'), 'utf8'),
    ).not.toContain('workspace_id');
    expect(requests).toEqual(['POST /oauth/token', 'GET /jsonapi/']);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
it('uses the current directory for a fresh explicitly named project without requiring --path', async () => {
  seed();
  const report = await run([
    'init',
    '--scope',
    'project',
    '--project',
    'demo',
    '--workspace',
    'Engineering',
    '--format',
    'json',
    '--dry-run',
  ]);
  expect(report.result).toBe('ok');
  expect(report.roots.project).toBe(cwd);
  expect(
    report.changes.some(
      (change: { path: string }) =>
        change.path === join(cwd, '.bakers/project.config.js'),
    ),
  ).toBe(true);
});
it('allows noninteractive project initialization without a workspace name', async () => {
  seed();

  const report = await run([
    'init',
    '--scope',
    'project',
    '--project',
    'demo',
    '--format',
    'json',
    '--dry-run',
  ]);

  expect(report.result).toBe('ok');
  // No hook answer was supplied, so the generated config correctly carries no
  // hooks key at all and no finding is raised — bakers-cli names no
  // provisioning tool and asks no question of its own.
  expect(report.findings).toEqual([]);
});
it('writes exactly the operator-supplied hooks, and no others, during noninteractive project initialization', async () => {
  seed();

  const report = await run([
    'init',
    '--scope',
    'project',
    '--project',
    'demo',
    '--after-create',
    'make worktree',
    '--after-done',
    'make clean',
    '--format',
    'json',
    '--dry-run',
  ]);

  expect(report.result).toBe('ok');
  expect(report.findings).toEqual([]);
  const written = report.changes.find(
    (change: { path: string }) =>
      change.path === join(cwd, '.bakers/project.config.js'),
  );
  expect(written).toBeTruthy();
});
it('does not prompt for an optional workspace name during interactive project initialization', async () => {
  seed();
  const questions: string[] = [];
  const program = new Command().exitOverride();
  config.registerConfig(program, {
    cwd,
    home,
    isTTY: true,
    env: {},
    stdout: () => {},
    prompt: async (label) => {
      questions.push(label);
      return 'Engineering';
    },
  });

  await program.parseAsync(
    [
      'config',
      'init',
      '--scope',
      'project',
      '--project',
      'demo',
      '--path',
      cwd,
    ],
    { from: 'user' },
  );

  expect(questions).not.toContain('Workspace name');
  expect(
    readFileSync(join(cwd, '.bakers/project.config.js'), 'utf8'),
  ).toContain("project: { name: 'demo' }");
});
it('does not prompt for shared prerequisite values outside the project write scope', async () => {
  seed();
  writeFileSync(
    join(home, '.bakers/machine.config.js'),
    'export default {schema_version:1};',
  );
  let output = '';
  const program = new Command().exitOverride();
  config.registerConfig(program, {
    cwd,
    home,
    isTTY: true,
    env: {},
    stdout: (s) => {
      output += s;
    },
    prompt: async () => {
      throw new Error('out-of-scope prompt');
    },
  });
  await program.parseAsync(
    [
      'config',
      'init',
      '--scope',
      'project',
      '--project',
      'demo',
      '--workspace',
      'Engineering',
      '--path',
      cwd,
    ],
    { from: 'user' },
  );
  expect(output).toContain('missing_required_key');
  expect(output).not.toContain('cancelled_selection');
  expect(existsSync(join(cwd, '.bakers/project.config.js'))).toBe(false);
});
it('device code is the only interview path, never asking for a secret', async () => {
  seed();
  rmSync(join(home, '.bakers/connections/default.js'));
  const asked: string[] = [];
  const report = await run(
    ['init', '--scope', 'connection', '--format', 'text'],
    {
      isTTY: true,
      prompt: async (label: string) => {
        asked.push(label);
        if (label.startsWith('Server base URL')) return 'https://example.test';
        if (label.startsWith('OAuth client identifier')) return '';
        if (label.startsWith('Workspace UUID')) return workspace;
        return '';
      },
      stdout: () => {},
    },
  );
  expect(asked.some((label) => label.startsWith('Sign in'))).toBe(false);
  expect(asked.some((label) => label.includes('secret'))).toBe(false);
  const text = readFileSync(
    join(home, '.bakers/connections/default.js'),
    'utf8',
  );
  expect(text).toContain('oauth2_device_code');
  expect(text).toContain('device_authorization_url');
  expect(text).toContain('bakers-cli');
  expect(text).not.toContain('client_secret');
  expect(report).toBeDefined();
});

it('takes the grant from --auth-type with no terminal at all', async () => {
  seed();
  rmSync(join(home, '.bakers/connections/default.js'));
  await run([
    'init',
    '--scope',
    'connection',
    '--format',
    'json',
    '--auth-type',
    'device',
    '--base-url',
    'https://example.test',
    '--client-id',
    'bakers-cli',
    '--workspace-id',
    workspace,
  ]);
  const text = readFileSync(
    join(home, '.bakers/connections/default.js'),
    'utf8',
  );
  expect(text).toContain('oauth2_device_code');
  expect(text).not.toContain('client_secret');
});

it.each([
  ['tunnel: true,', true],
  ['tunnel: false,', false],
  ['', false],
])('check --scope machine reports tunnel policy %s in json and text', async (field, expected) => {
  seed();
  const path = join(home, '.bakers/machine.config.js');
  writeFileSync(
    path,
    `export default {schema_version:1,machine_id:'0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30',label:'operator',${field}};`,
  );
  const json = await run(['check', '--scope', 'machine', '--format', 'json']);
  expect(json.machine_policy).toEqual({ tunnel: expected, source: path });
  expect(json.result).toBe('ok');
  const text = await run(['check', '--scope', 'machine', '--format', 'text']);
  expect(text).toContain(`Machine tunnel: ${expected} (from ${path})`);
});

it('check --scope machine names the machine file that sets the executor', async () => {
  seed();
  const path = join(home, '.bakers/machine.config.js');
  writeFileSync(
    path,
    "export default {schema_version:1,machine_id:'0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30',label:'operator',executor:{plugin:'@bakers-build/addon-herdr-core'}};",
  );
  const json = await run(['check', '--scope', 'machine', '--format', 'json']);
  expect(json.executor_source).toBe(path);
  const text = await run(['check', '--scope', 'machine', '--format', 'text']);
  expect(text).toContain(`Executor: from ${path}`);
});

it('check --scope machine reports unresolved tunnel policy for invalid literals', async () => {
  seed();
  const path = join(home, '.bakers/machine.config.js');
  writeFileSync(
    path,
    "export default {schema_version:1,machine_id:'0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30',label:'operator',tunnel:'true'};",
  );
  const json = await run(['check', '--scope', 'machine', '--format', 'json']);
  expect(json.machine_policy).toEqual({ tunnel: null, source: path });
  expect(json.findings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: 'invalid_value', key: 'tunnel' }),
    ]),
  );
  const text = await run(['check', '--scope', 'machine', '--format', 'text']);
  expect(text).toContain(`Machine tunnel: unresolved (from ${path})`);
});

it('check --scope machine keeps the missing-file diagnostic and defaults tunnel false', async () => {
  const path = join(home, '.bakers/machine.config.js');
  const json = await run(['check', '--scope', 'machine', '--format', 'json']);
  expect(json.machine_policy).toEqual({ tunnel: false, source: path });
  expect(json.findings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: 'missing_required_file', path }),
    ]),
  );
});

it('check --scope connection does not take tunnel policy from a connection file', async () => {
  seed();
  writeFileSync(
    join(home, '.bakers/connections/default.js'),
    `export default {schema_version:1,site:{base_url:'https://example.test'},workspace_id:'${workspace}',plugins:[],tunnel:true};`,
  );
  const json = await run([
    'check',
    '--scope',
    'connection',
    '--format',
    'json',
  ]);
  expect(json.machine_policy).toBeUndefined();
  expect(json.findings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: 'misplaced_key',
        key: 'tunnel',
        owner: 'machine',
      }),
    ]),
  );
});

it('check --machine-path reports tunnel policy from the selected file', async () => {
  seed();
  const path = join(root, 'other-machine.js');
  writeFileSync(
    path,
    "export default {schema_version:1,machine_id:'0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30',label:'other',tunnel:true};",
  );
  const json = await run([
    'check',
    '--scope',
    'machine',
    '--machine-path',
    path,
    '--format',
    'json',
  ]);
  expect(json.machine_policy).toEqual({ tunnel: true, source: path });
});

it('a fresh device-code connection ends ok with sign-in named as the outstanding step', async () => {
  seed();
  rmSync(join(home, '.bakers/connections/default.js'));
  const args = [
    'init',
    '--scope',
    'connection',
    '--format',
    'json',
    '--auth-type',
    'device',
    '--base-url',
    'https://example.test',
    '--client-id',
    'bakers-cli',
  ];

  // Writing the connection and signing in are two steps. Reporting the gap
  // between them as an authentication failure names a symptom rather than a
  // cause, and leaves `bakers init` reporting `failed` on a correct machine.
  const first = await run(args);
  expect(first.result).toBe('ok');
  expect(
    first.findings.map((finding: { code: string }) => finding.code),
  ).not.toContain('authentication_failure');
  expect(first.verification.online.status).toBe('pending');
  expect(first.verification.online.reason).toContain('auth login');

  const before = readFileSync(
    join(home, '.bakers/connections/default.js'),
    'utf8',
  );
  const second = await run(args);
  expect(second.result).toBe('ok');
  expect(second.changes).toEqual([]);
  expect(
    readFileSync(join(home, '.bakers/connections/default.js'), 'utf8'),
  ).toBe(before);
});

it('re-running init over an existing device-code connection stays ok without a flag', async () => {
  seed();
  rmSync(join(home, '.bakers/connections/default.js'));
  await run([
    'init',
    '--scope',
    'connection',
    '--format',
    'json',
    '--auth-type',
    'device',
    '--base-url',
    'https://example.test',
    '--client-id',
    'bakers-cli',
  ]);

  // The diagnostic run: no --auth-type, nothing fresh to write. The grant has
  // to come from the connection itself or this reports a failure again.
  const again = await run([
    'init',
    '--scope',
    'connection',
    '--format',
    'json',
    '--base-url',
    'https://example.test',
    '--client-id',
    'bakers-cli',
  ]);
  expect(again.result).toBe('ok');
  expect(
    again.findings.map((finding: { code: string }) => finding.code),
  ).not.toContain('authentication_failure');
});

it('an explicit --online verifies a fresh device-code connection instead of deferring it', async () => {
  seed();
  rmSync(join(home, '.bakers/connections/default.js'));

  // Deferring verification is the right default for a device-code connection
  // nobody has signed into yet, but --online is the operator asking for the
  // check anyway. It has to run, whatever it then reports.
  const report = await run([
    'init',
    '--scope',
    'connection',
    '--format',
    'json',
    '--online',
    '--auth-type',
    'device',
    '--base-url',
    'https://example.test',
    '--client-id',
    'bakers-cli',
  ]);
  expect(report.verification.online.status).not.toBe('pending');
  expect(
    report.verification.skipped.some(
      (entry: { stage: string }) => entry.stage === 'online',
    ),
  ).toBe(false);
});

it('upgrade --online --auth-type device verifies rather than waiting for sign-in', async () => {
  seed();
  rmSync(join(home, '.bakers/connections/default.js'));
  await run([
    'init',
    '--scope',
    'connection',
    '--format',
    'json',
    '--auth-type',
    'device',
    '--base-url',
    'https://example.test',
    '--client-id',
    'bakers-cli',
  ]);

  // The other operation that takes --auth-type. Nothing is written here, so
  // deferring verification would leave --online with nothing to report.
  const report = await run([
    'upgrade',
    '--scope',
    'connection',
    '--format',
    'json',
    '--online',
    '--auth-type',
    'device',
  ]);
  expect(report.verification.online.status).not.toBe('pending');
  expect(
    report.verification.skipped.some(
      (entry: { stage: string }) => entry.stage === 'online',
    ),
  ).toBe(false);
});

it('reads the grant off the OAuth plugin even when an earlier plugin carries its own with.type', async () => {
  seed();
  const baseUrl = 'https://example.test';
  writeFileSync(
    join(home, '.bakers/connections/default.js'),
    `export default {schema_version:1,site:{base_url:'${baseUrl}'},workspace_id:'${workspace}',plugins:[
      {plugin:'@bakers-build/addon-essentials', with:{type:'oauth2_client_credentials'}},
      {plugin:'@dropsh/plugin-oauth2', export:'oauth2Plugin', with:{
        id:'bakers', default:true, type:'oauth2_device_code',
        client_id:'bakers-cli', scope:'bb:session',
        token_url:'${baseUrl}/oauth/token',
        device_authorization_url:'${baseUrl}/oauth/device_authorization'}}]};`,
  );

  // The decoy plugin sits first and is not the OAuth one. Matching on field
  // shape alone reads its grant, concludes no sign-in is pending, and
  // verifies a connection nobody has signed into yet.
  const report = await run([
    'init',
    '--scope',
    'connection',
    '--format',
    'json',
    '--base-url',
    baseUrl,
    '--client-id',
    'bakers-cli',
  ]);
  expect(report.verification.online.status).toBe('pending');
  expect(report.verification.online.reason).toContain('auth login');
});

it('a repeat init on a signed-in setup stops asking for another sign-in', async () => {
  seed();
  rmSync(join(home, '.bakers/connections/default.js'));
  const args = [
    'init',
    '--scope',
    'connection',
    '--format',
    'json',
    '--auth-type',
    'device',
    '--base-url',
    'https://example.test',
    '--client-id',
    'bakers-cli',
  ];
  await run(args);

  // The diagnostic run the skill recommends, on a machine whose session is
  // already live. Naming sign-in as the next step there tells the person to
  // do again the one thing they have already done.
  mkdirSync(join(home, '.config/dropsh'), { recursive: true });
  writeFileSync(
    join(home, '.config/dropsh/example.test.json'),
    JSON.stringify({
      version: 2,
      active: 'bakers',
      profiles: {
        bakers: {
          provider: 'bakers',
          session: {
            access_token: 'token',
            expires_at: Date.now() + 3_600_000,
          },
        },
      },
    }),
  );

  const report = await run(args);
  expect(report.verification.online.status).toBe('pending');
  expect(report.verification.online.reason).not.toContain('auth login');
  expect(report.verification.online.reason).toContain('--online');
});

it('a repeat init after the access token expired still counts the refreshable session', async () => {
  seed();
  rmSync(join(home, '.bakers/connections/default.js'));
  const args = [
    'init',
    '--scope',
    'connection',
    '--format',
    'json',
    '--auth-type',
    'device',
    '--base-url',
    'https://example.test',
    '--client-id',
    'bakers-cli',
  ];
  await run(args);

  // Hours after sign-in the access token has lapsed, but the stored refresh
  // token renews it silently on the next request — signing in again is not
  // the next step.
  mkdirSync(join(home, '.config/dropsh'), { recursive: true });
  writeFileSync(
    join(home, '.config/dropsh/example.test.json'),
    JSON.stringify({
      version: 2,
      active: 'bakers',
      profiles: {
        bakers: {
          provider: 'bakers',
          session: {
            access_token: 'token',
            refresh_token: 'refresh',
            expires_at: Date.now() - 3_600_000,
          },
        },
      },
    }),
  );

  const report = await run(args);
  expect(report.verification.online.status).toBe('pending');
  expect(report.verification.online.reason).not.toContain('auth login');
  expect(report.verification.online.reason).toContain('--online');
});
it('reports an addon in a scope it does not allow', async () => {
  seed();
  writeFileSync(
    join(home, '.bakers/machine.config.js'),
    "export default {schema_version:1,machine_id:'0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30',label:'operator',addons:['@bakers-build/addon-herdr']};",
  );
  const report = await run([
    'check',
    '--scope',
    'machine',
    '--online',
    '--format',
    'json',
  ]);
  const finding = report.findings.find(
    (f: { code: string }) => f.code === 'addon_scope_not_allowed',
  );
  expect(finding).toMatchObject({
    severity: 'error',
    path: join(home, '.bakers/machine.config.js'),
    key: 'addons',
  });
  expect(finding.remediation).toContain('.bakers/project.config.js');
  expect(report.result).toBe('blocked');
});
// BAKERS-159: addon options are checked offline from the addon's
// options.schema.json; the --online-only addon_with_invalid finding is gone.
it('config check reports an invalid addon option at addons[0].with.services[0].key offline', async () => {
  seed();
  writeFileSync(
    join(home, '.bakers/machine.config.js'),
    "export default {schema_version:1,machine_id:'0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30',label:'operator',addons:[{use:'@bakers-build/addon-ports',with:{services:[{key:'Docs!',match:'vitepress'}]}}]};",
  );
  const report = await run(['check', '--scope', 'machine', '--format', 'json']);
  const found = report.findings.filter(
    (f: { code: string }) => f.code === 'invalid_value',
  );
  expect(found).toHaveLength(1);
  expect(found[0]).toMatchObject({
    severity: 'error',
    path: join(home, '.bakers/machine.config.js'),
    key: 'addons[0].with.services[0].key',
  });
  expect(found[0].expected).toContain('DNS-safe label');
  expect(report.result).toBe('blocked');
});
it('offline check skips the scope check with an info finding', async () => {
  seed();
  writeFileSync(
    join(home, '.bakers/machine.config.js'),
    "export default {schema_version:1,machine_id:'0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30',label:'operator',addons:['@bakers-build/addon-herdr']};",
  );
  const report = await run(['check', '--scope', 'machine', '--format', 'json']);
  expect(
    report.findings.some(
      (f: { code: string }) => f.code === 'addon_scope_not_allowed',
    ),
  ).toBe(false);
  const scoped = report.findings.filter(
    (f: { code: string }) => f.code === 'addon_scope_skipped',
  );
  expect(scoped).toHaveLength(1);
  expect(
    report.findings.some(
      (f: { code: string }) => f.code === 'addon_with_invalid',
    ),
  ).toBe(false);
  expect(scoped[0].severity).toBe('info');
  expect(scoped[0].remediation).toContain('--online');
});
