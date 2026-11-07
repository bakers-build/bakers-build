import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as core from '../../src/index.js';

describe('offline configuration inventory', () => {
  let root: string;
  let home: string;
  let project: string;
  const put = (path: string, text: string) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    return path;
  };
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'bakers-inventory-'));
    home = join(root, 'home');
    project = join(root, 'project');
    mkdirSync(home);
    mkdirSync(project);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('reports a missing machine with an exact repair and never requires a connection', () => {
    expect(core).toHaveProperty('inventoryConfig');
    const { report } = core.inventoryConfig({
      scope: 'machine',
      home,
      cwd: project,
    });
    expect(
      report.files.filter((file) => file.selected).map((file) => file.kind),
    ).toEqual(['machine']);
    expect(report.findings).toEqual([
      expect.objectContaining({
        code: 'missing_required_file',
        path: join(home, '.bakers/machine.config.js'),
        owner: 'machine',
        remediation: 'bakers config init --scope machine',
        recheck: 'bakers config check --scope machine',
      }),
    ]);
    expect(report.verification.online).toEqual({
      status: 'not_applicable',
      reason: 'Machine scope has no connection validation.',
    });
    expect(report.result).toBe('blocked');
  });

  it('reports no finding for a connection without a workspace', () => {
    put(
      join(home, '.bakers/bakers.config.js'),
      "export default {site:{base_url:'https://fixture.test'},plugins:[]};",
    );
    const { report } = core.inventoryConfig({
      scope: 'connection',
      home,
      cwd: project,
    });
    expect(report.findings.map((f) => f.key)).not.toContain('workspace_id');
  });

  it('discovers a partial project and includes variants and local provenance', () => {
    mkdirSync(join(project, '.bakers'));
    const local = put(
      join(project, '.bakers/conductor.config.local.js'),
      'export default {};',
    );
    const variant = put(
      join(project, '.bakers/worker.conductor.config.js'),
      'export default {};',
    );
    const { report } = core.inventoryConfig({
      scope: 'all',
      home,
      cwd: project,
    });
    expect(report.roots.project).toBe(project);
    expect(report.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: local,
          kind: 'local',
          role: 'supplementary',
          selected: true,
        }),
        expect.objectContaining({
          path: variant,
          kind: 'conductor',
          role: 'primary',
          selected: true,
        }),
        expect.objectContaining({
          path: join(project, '.bakers/bakers.config.js'),
          required: false,
          state: 'absent',
        }),
      ]),
    );
  });

  it('recognizes an empty .bakers for configuration work without changing runtime conductor discovery', () => {
    mkdirSync(join(project, '.bakers'));
    const { report } = core.inventoryConfig({
      scope: 'project',
      home,
      cwd: project,
    });
    expect(report.roots.project).toBe(project);
    expect(core.findBbDir(project)).toBeUndefined();
  });

  it('rejects invalid scope and unresolved project, and reports project as inapplicable outside one', () => {
    expect(
      core.inventoryConfig({ scope: 'user', home, cwd: project }).report
        .findings[0]?.code,
    ).toBe('invalid_scope');
    expect(
      core.inventoryConfig({ scope: 'project', home, cwd: project }).report
        .findings[0]?.code,
    ).toBe('project_required');
    expect(
      core.inventoryConfig({ home, cwd: project }).report.resolved_scopes,
    ).toEqual(['machine', 'connection']);
    expect(
      core.inventoryConfig({ operation: 'init', home, cwd: project }).report
        .findings[0]?.code,
    ).toBe('scope_required');
  });

  it('aggregates syntax, unreadable, and missing-file defects without executing source', () => {
    const sentinel = join(root, 'executed');
    const machine = put(
      join(home, '.bakers/machine.config.js'),
      `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(sentinel)}, 'oops'); export default { machine_id: '0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30', label: 'cw', max_parallel: 1 };`,
    );
    put(
      join(home, '.bakers/bakers.config.js'),
      'export default { site: { base_url: ; } };',
    );
    mkdirSync(join(project, '.bakers/conductor.config.js'), {
      recursive: true,
    });
    const { report } = core.inventoryConfig({
      scope: 'all',
      home,
      cwd: project,
    });
    expect(existsSync(sentinel)).toBe(false);
    expect(
      report.files.find((file) => file.path === machine)?.fingerprint,
    ).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(report.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(['syntax_error', 'unreadable_file']),
    );
    expect(report.verification.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: 'schema',
          reason: 'Syntax validation failed.',
        }),
      ]),
    );
  });

  it('aggregates independent invalid literals and redacts every secret-bearing expression in reports', () => {
    put(
      join(home, '.bakers/machine.config.js'),
      `export default { machine_id: '', label: '', max_parallel: 0, client_secret: process.env.DO_NOT_LEAK };`,
    );
    const { report, sources } = core.inventoryConfig({
      scope: 'machine',
      home,
      cwd: project,
    });
    expect(report.findings.map((finding) => finding.key)).toEqual(
      expect.arrayContaining(['machine_id', 'label', 'client_secret']),
    );
    // The run budget is a backend setting: no check reads it.
    expect(
      report.findings.some((finding) => finding.key === 'max_parallel'),
    ).toBe(false);
    expect(
      report.findings.find((finding) => finding.key === 'client_secret'),
    ).toMatchObject({
      code: 'misplaced_key',
      observed: '[REDACTED]',
      statically_determined: false,
    });
    expect(JSON.stringify(report)).not.toContain('DO_NOT_LEAK');
    expect(
      sources.get(join(home, '.bakers/machine.config.js'))?.text,
    ).toContain('DO_NOT_LEAK');
  });

  it('reports agents.addons as retired with the addons fragment', () => {
    put(
      join(home, '.bakers/machine.config.js'),
      `export default { machine_id: '0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30', label: 'cw', max_parallel: 1, agents: { addons: ['@bakers-build/addon-claude'] } };`,
    );
    const { report } = core.inventoryConfig({
      scope: 'machine',
      home,
      cwd: project,
    });
    const finding = report.findings.find((f) => f.key === 'agents.addons');
    expect(finding).toMatchObject({ code: 'retired_key', severity: 'error' });
    expect(finding?.remediation).toContain(
      "addons: ['@bakers-build/addon-claude']",
    );
  });

  it.each([
    [
      'a retired user_id',
      `machine_id: '%s', label: 'cw', user_id: 'cw'`,
      'user_id',
    ],
  ])('rejects %s naming bakers init', (_, body, key) => {
    put(
      join(home, '.bakers/machine.config.js'),
      `export default { ${body.replace('%s', '0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30')}, max_parallel: 1 };`,
    );
    const { report } = core.inventoryConfig({
      scope: 'machine',
      home,
      cwd: project,
    });
    const finding = report.findings.find((f) => f.key === key);
    expect(finding?.severity).toBe('error');
    expect(finding?.remediation).toContain('bakers init');
  });

  it('requires a machine label', () => {
    put(
      join(home, '.bakers/machine.config.js'),
      `export default { machine_id: '0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30', max_parallel: 1 };`,
    );
    const { report } = core.inventoryConfig({
      scope: 'machine',
      home,
      cwd: project,
    });
    expect(report.findings).toEqual([
      expect.objectContaining({ code: 'missing_required_key', key: 'label' }),
    ]);
  });

  it('refuses a schema version other than the current one, naming bakers init', () => {
    put(
      join(home, '.bakers/machine.config.js'),
      `// @bakers-schema-version 3\nexport default { schema_version: 3, machine_id: '0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30', label: 'cw', max_parallel: 1 };`,
    );
    const { report } = core.inventoryConfig({
      scope: 'machine',
      home,
      cwd: project,
      currentVersions: { machine: 1 },
    });
    const finding = report.findings.find((f) => f.key === 'schema_version');
    expect(finding).toMatchObject({
      code: 'unsupported_schema_version',
      severity: 'error',
    });
    expect(finding?.remediation).toContain('bakers init');
  });

  it('reports ports as retired with the ports addon fragment', () => {
    put(
      join(home, '.bakers/machine.config.js'),
      `export default { machine_id: '0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30', label: 'cw', max_parallel: 1, ports: { transport: { use: '@bakers-build/ports-cloudflare-quick' } } };`,
    );
    const { report } = core.inventoryConfig({
      scope: 'machine',
      home,
      cwd: project,
    });
    const finding = report.findings.find((f) => f.key === 'ports');
    expect(finding).toMatchObject({ code: 'retired_key', severity: 'error' });
    expect(finding?.remediation).toContain(
      "addons: [{ use: '@bakers-build/addon-ports', with: { transport: { use: '@bakers-build/ports-cloudflare-quick' } } }]",
    );
  });

  it('never echoes a secret from a retired ports block', () => {
    put(
      join(home, '.bakers/machine.config.js'),
      `export default { machine_id: '0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30', label: 'cw', max_parallel: 1, ports: { transport: { use: '@bakers-build/addon-ports-cloudflare', with: { accountId: 'acc-1', apiToken: 'super-secret-token' } } } };`,
    );
    const { report } = core.inventoryConfig({
      scope: 'machine',
      home,
      cwd: project,
    });
    expect(report.findings.find((f) => f.key === 'ports')?.code).toBe(
      'retired_key',
    );
    expect(JSON.stringify(report)).not.toContain('super-secret-token');
  });

  it('leaves `ports` optional: its absence reports no finding', () => {
    put(
      join(home, '.bakers/machine.config.js'),
      `export default { machine_id: '0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30', label: 'cw', max_parallel: 1 };`,
    );
    const { report } = core.inventoryConfig({
      scope: 'machine',
      home,
      cwd: project,
    });
    expect(report.findings.some((f) => f.key?.startsWith('ports.'))).toBe(
      false,
    );
  });

  it('reports computed critical values as incomplete with truthful source locations', () => {
    put(
      join(home, '.bakers/machine.config.js'),
      `export default {\n machine_id: process.env.HOST,\n label: 'cw', max_parallel: 1 };`,
    );
    const { report } = core.inventoryConfig({
      scope: 'machine',
      home,
      cwd: project,
    });
    expect(report.result).toBe('incomplete');
    expect(report.findings).toEqual([
      expect.objectContaining({
        code: 'unknown_value',
        key: 'machine_id',
        line: 2,
        column: 2,
        statically_determined: false,
        observed: '[COMPUTED]',
      }),
    ]);
  });

  it('diagnoses version marker disagreement and unsupported versions even in partial files', () => {
    put(
      join(home, '.bakers/bakers.config.js'),
      '// @bakers-schema-version 99\nexport default { schema_version: 1 };',
    );
    const { report } = core.inventoryConfig({
      scope: 'connection',
      home,
      cwd: project,
      currentVersions: { connection: 4 },
    });
    expect(report.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        'version_marker_disagreement',
        'unsupported_schema_version',
        'missing_required_key',
      ]),
    );
    expect(
      report.files.find((file) => file.kind === 'connection')?.version,
    ).toEqual({ header: 99, field: 1, current: 4, effective: null });
  });

  it('returns nested property spans without exposing source in a public file record', () => {
    const text =
      "// export default { fake: true }\nexport default { site: { base_url: 'https://example.test' }, plugins: [{ plugin: 'auth', with: { client_secret: 'sensitive' } }] };";
    const inspection = core.inspectConfigSource(text);
    expect(inspection.syntax).toBe('valid');
    expect(inspection.properties.get('site.base_url')?.value).toBe(
      'https://example.test',
    );
    const secret = inspection.properties.get('plugins[0].with.client_secret');
    expect(text.slice(secret?.valueStart, secret?.valueEnd)).toBe(
      "'sensitive'",
    );
    expect(inspection.properties.has('fake')).toBe(false);
  });

  it('does not treat strings, comments or computed spreads as known exported values', () => {
    const text =
      "const note = 'export default { machine_id: 7 }'; export default { machine_id: 'host', ...process.env.OVERRIDE };";
    const inspection = core.inspectConfigSource(text);
    expect(inspection.properties.get('machine_id')?.staticallyDetermined).toBe(
      false,
    );
    expect(inspection.unknownKeys).toBe(true);
  });

  it('validates literal connection structure and keeps offline success distinct from online readiness', () => {
    put(
      join(home, '.bakers/bakers.config.js'),
      `export default { site: { base_url: 'https://example.test' }, workspace_id: 'a1e559a4-2fb8-4f2f-8d69-1c194f913bd1', plugins: [{ plugin: '@dropsh/plugin-oauth2', export: 'oauth2Plugin', with: { id: 'bakers', client_id: 'client', client_secret: 'secret', scope: 'bb:session' } }] };`,
    );
    const { report } = core.inventoryConfig({
      scope: 'connection',
      home,
      cwd: project,
    });
    expect(report.result).toBe('ok');
    expect(report.verification.offline.status).toBe('passed');
    expect(report.verification.online.status).toBe('pending');
    expect(report.verification.readiness).toBe('unverified');
    expect(JSON.stringify(report)).not.toContain('secret');
  });

  it('validates URL and plugin descriptors independently', () => {
    put(
      join(home, '.bakers/bakers.config.js'),
      `export default { site: { base_url: 'ftp://example.test' }, plugins: [{ plugin: 23 }] };`,
    );
    const { report } = core.inventoryConfig({
      scope: 'connection',
      home,
      cwd: project,
    });
    expect(report.findings.map((finding) => finding.key)).toEqual(
      expect.arrayContaining(['site.base_url', 'plugins[0].plugin']),
    );
  });

  it('reports an existing project connection as supported but superseded', () => {
    const path = put(
      join(project, '.bakers/bakers.config.js'),
      `export default { site: { base_url: 'https://example.test' }, workspace_id: 'a1e559a4-2fb8-4f2f-8d69-1c194f913bd1', plugins: [{ plugin: '@dropsh/plugin-oauth2', with: { client_id: 'client', client_secret: 'DO_NOT_LEAK' } }] };`,
    );
    const { report } = core.inventoryConfig({
      scope: 'project',
      home,
      cwd: project,
    });
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'superseded_file',
          path,
          severity: 'info',
        }),
      ]),
    );
    expect(JSON.stringify(report)).not.toContain('DO_NOT_LEAK');
  });

  it('reports an unsupported export as incomplete and still inventories independent selected files', () => {
    put(
      join(home, '.bakers/machine.config.js'),
      'export default makeConfig();',
    );
    const { report } = core.inventoryConfig({
      scope: 'all',
      home,
      cwd: project,
    });
    expect(report.findings.map((finding) => finding.code)).toEqual([
      'unsupported_source_shape',
      'missing_required_file',
    ]);
    expect(report.files.find((file) => file.kind === 'machine')?.state).toBe(
      'unsupported',
    );
  });

  it('detects syntax defects beyond delimiters and records fresh content fingerprints', () => {
    const path = put(
      join(home, '.bakers/machine.config.js'),
      "const broken = ; export default { machine_id: '0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30', label: 'cw', max_parallel: 1 };",
    );
    const before = core.inventoryConfig({
      scope: 'machine',
      home,
      cwd: project,
    }).report;
    expect(before.findings[0]?.code).toBe('syntax_error');
    put(
      path,
      "const matcher = /}/; export default { machine_id: '0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30', label: 'cw', max_parallel: 1 };",
    );
    const after = core.inventoryConfig({
      scope: 'machine',
      home,
      cwd: project,
    }).report;
    expect(after.result).toBe('ok');
    expect(after.files[0]?.fingerprint).not.toBe(before.files[0]?.fingerprint);
  });

  it('does not guess array item indexes after a dynamic spread', () => {
    const inspection = core.inspectConfigSource(
      "export default { plugins: [...extras, { plugin: 'custom' }] };",
    );
    expect(
      inspection.properties.get('plugins[1].plugin')?.staticallyDetermined,
    ).not.toBe(true);
  });

  it('a custom connection path keeps all remediation commands pointed at that selected file', () => {
    const path = put(join(root, 'custom config.js'), 'export default {};');
    const { report } = core.inventoryConfig({
      scope: 'connection',
      home,
      cwd: project,
      connectionPath: path,
    });
    expect(report.findings[0]?.recheck).toContain("--config '");
    expect(report.findings[0]?.recheck).toContain(path);
  });
  // ~/.config/conductor belongs to other tools; bakers must not read it.
  it('never inventories a conductor machine file under ~/.config/conductor', () => {
    const legacy = put(
      join(home, '.config/conductor/conductor.config.machine.js'),
      "export default {machine_id:'old',user_id:'old'};",
    );
    expect(
      core
        .inventoryConfig({ scope: 'all', home, cwd: project })
        .report.files.some((f) => f.path === legacy),
    ).toBe(false);
  });
  // A historical global connection imports this sibling; migrating past it unseen switches server or account.
  it('refuses a retired conductor.config.local.js beside the global connection', () => {
    const retired = put(
      join(home, '.bakers/conductor.config.local.js'),
      "export default {base_url:'https://other.test'};",
    );
    const { report } = core.inventoryConfig({
      scope: 'connection',
      home,
      cwd: project,
    });
    expect(report.files.some((f) => f.path === retired)).toBe(false);
    expect(report.findings).toContainEqual(
      expect.objectContaining({
        code: 'superseded_file',
        severity: 'error',
        path: retired,
      }),
    );
  });

  it('requires no client_secret from a device-code descriptor, and still requires the client_id', () => {
    put(
      join(home, '.bakers/bakers.config.js'),
      `export default { schema_version: 4, site: { base_url: 'https://example.test' }, workspace_id: 'a1e559a4-2fb8-4f2f-8d69-1c194f913bd1', plugins: [{ plugin: '@dropsh/plugin-oauth2', export: 'oauth2Plugin', with: { id: 'bakers', default: true, type: 'oauth2_device_code', scope: 'bb:session', client_id: 'bakers-cli' } }] };`,
    );
    const { report } = core.inventoryConfig({
      scope: 'connection',
      home,
      cwd: project,
    });
    expect(
      report.findings.filter((finding) =>
        finding.key?.endsWith('client_secret'),
      ),
    ).toEqual([]);
  });

  it('still requires a client_secret when the descriptor states no grant type', () => {
    put(
      join(home, '.bakers/bakers.config.js'),
      `export default { schema_version: 4, site: { base_url: 'https://example.test' }, workspace_id: 'a1e559a4-2fb8-4f2f-8d69-1c194f913bd1', plugins: [{ plugin: '@dropsh/plugin-oauth2', with: { client_id: 'client' } }] };`,
    );
    const { report } = core.inventoryConfig({
      scope: 'connection',
      home,
      cwd: project,
    });
    expect(
      report.findings.some(
        (finding) =>
          finding.code === 'missing_required_key' &&
          finding.key === 'plugins[0].with.client_secret',
      ),
    ).toBe(true);
  });

  it.each([
    ['tunnel: true,', true],
    ['tunnel: false,', false],
    ['', false],
  ])('reports machine tunnel policy for %s', (field, expected) => {
    const path = put(
      join(home, '.bakers/machine.config.js'),
      `export default {schema_version:1,machine_id:'0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30',label:'operator',max_parallel:1,${field}};`,
    );
    const { report } = core.inventoryConfig({
      scope: 'machine',
      home,
      cwd: project,
    });
    expect(report.machine_policy).toEqual({ tunnel: expected, source: path });
    expect(report.result).toBe('ok');
  });

  it.each([
    ["tunnel: 'true',", 'true'],
    ['tunnel: 1,', 1],
    ['tunnel: null,', null],
  ])('rejects a non-boolean machine tunnel literal %s', (field, observed) => {
    const path = put(
      join(home, '.bakers/machine.config.js'),
      `export default {schema_version:1,machine_id:'0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30',label:'operator',max_parallel:1,${field}};`,
    );
    const { report } = core.inventoryConfig({
      scope: 'machine',
      home,
      cwd: project,
    });
    expect(report.machine_policy).toEqual({ tunnel: null, source: path });
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid_value',
          key: 'tunnel',
          ...(observed === null ? {} : { observed }),
        }),
      ]),
    );
    expect(report.result).toBe('blocked');
  });

  it('leaves machine tunnel unresolved for a computed expression', () => {
    const sentinel = join(root, 'executed');
    const path = put(
      join(home, '.bakers/machine.config.js'),
      `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(sentinel)}, 'oops'); export default {schema_version:1,machine_id:'0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30',label:'operator',max_parallel:1,tunnel: process.env.TUNNEL === '1'};`,
    );
    const { report } = core.inventoryConfig({
      scope: 'machine',
      home,
      cwd: project,
    });
    expect(existsSync(sentinel)).toBe(false);
    expect(report.machine_policy).toEqual({ tunnel: null, source: path });
    expect(report.findings).toEqual([
      expect.objectContaining({ code: 'unknown_value', key: 'tunnel' }),
    ]);
    expect(report.result).toBe('incomplete');
  });

  it('does not treat a spread as a proven absent tunnel field', () => {
    const path = put(
      join(home, '.bakers/machine.config.js'),
      "export default {schema_version:1,machine_id:'0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30',label:'operator',max_parallel:1,...process.env.OVERRIDE};",
    );
    const { report } = core.inventoryConfig({
      scope: 'machine',
      home,
      cwd: project,
    });
    expect(report.machine_policy).toEqual({ tunnel: null, source: path });
    expect(
      report.findings.some(
        (finding) =>
          finding.code === 'unknown_value' && finding.key === 'tunnel',
      ),
    ).toBe(true);
  });

  it('defaults a missing machine file tunnel policy to false beside the existing diagnostic', () => {
    const path = join(home, '.bakers/machine.config.js');
    const { report } = core.inventoryConfig({
      scope: 'machine',
      home,
      cwd: project,
    });
    expect(report.machine_policy).toEqual({ tunnel: false, source: path });
    expect(report.findings).toEqual([
      expect.objectContaining({
        code: 'missing_required_file',
        path,
      }),
    ]);
  });

  it('leaves tunnel unresolved for unreadable or unsupported machine sources', () => {
    const malformed = put(
      join(home, '.bakers/machine.config.js'),
      'export default makeConfig();',
    );
    const unsupported = core.inventoryConfig({
      scope: 'machine',
      home,
      cwd: project,
    }).report;
    expect(unsupported.machine_policy).toEqual({
      tunnel: null,
      source: malformed,
    });

    put(
      join(home, '.bakers/machine.config.js'),
      "const broken = ; export default { machine_id: '0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30', label: 'cw', max_parallel: 1 };",
    );
    const syntax = core.inventoryConfig({
      scope: 'machine',
      home,
      cwd: project,
    }).report;
    expect(syntax.machine_policy).toEqual({
      tunnel: null,
      source: malformed,
    });
  });

  it('diagnoses a connection or project tunnel field as misplaced and never uses it as policy', () => {
    put(
      join(home, '.bakers/machine.config.js'),
      "export default {schema_version:1,machine_id:'0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30',label:'operator',max_parallel:1};",
    );
    put(
      join(home, '.bakers/bakers.config.js'),
      "export default {schema_version:4,site:{base_url:'https://example.test'},plugins:[],tunnel:true};",
    );
    mkdirSync(join(project, '.bakers'));
    put(
      join(project, '.bakers/conductor.config.js'),
      "export default {conductor_id:'cw-host-project',tunnel:true};",
    );
    const connection = core.inventoryConfig({
      scope: 'connection',
      home,
      cwd: project,
    }).report;
    expect(connection.machine_policy).toBeUndefined();
    expect(connection.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'misplaced_key',
          key: 'tunnel',
          owner: 'machine',
        }),
      ]),
    );

    const projectReport = core.inventoryConfig({
      scope: 'project',
      home,
      cwd: project,
    }).report;
    expect(projectReport.machine_policy).toBeUndefined();
    expect(projectReport.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'misplaced_key',
          key: 'tunnel',
          owner: 'machine',
        }),
      ]),
    );
  });

  it('neither requires max_parallel on the machine nor reports it elsewhere', () => {
    put(
      join(home, '.bakers/machine.config.js'),
      "export default {schema_version:1,machine_id:'0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30',label:'operator'};",
    );
    put(
      join(home, '.bakers/bakers.config.js'),
      "export default {schema_version:1,site:{base_url:'https://example.test'},plugins:[],max_parallel:3};",
    );
    mkdirSync(join(project, '.bakers'));
    put(
      join(project, '.bakers/conductor.config.js'),
      'export default {max_parallel:3,conductor:{max_parallel:3}};',
    );
    for (const scope of ['machine', 'connection', 'project'] as const) {
      const { report } = core.inventoryConfig({ scope, home, cwd: project });
      expect(
        report.findings.filter((f) => f.key?.includes('max_parallel')),
      ).toEqual([]);
    }
  });

  it('names the machine file as the executor source when it overrides the project', () => {
    const machine = put(
      join(home, '.bakers/machine.config.js'),
      "export default {schema_version:1,machine_id:'0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30',label:'operator',executor:{plugin:'@bakers-build/addon-herdr-core'}};",
    );
    const conductor = put(
      join(project, '.bakers/conductor.config.js'),
      "export default {bakers:{project:'bakers'},executor:{plugin:'@bakers-build/addon-herdr'}};",
    );
    const all = core.inventoryConfig({ scope: 'all', home, cwd: project });
    expect(all.report.executor_source).toBe(machine);
    expect(all.report.findings.filter((f) => f.key === 'executor')).toEqual([]);

    put(
      machine,
      "export default {schema_version:1,machine_id:'0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30',label:'operator'};",
    );
    const project_only = core.inventoryConfig({
      scope: 'all',
      home,
      cwd: project,
    });
    expect(project_only.report.executor_source).toBe(conductor);
  });

  it('reports tunnel policy from an explicit machine path', () => {
    const path = put(
      join(root, 'isolated-machine.js'),
      "export default {schema_version:1,machine_id:'0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30',label:'fixture',max_parallel:1,tunnel:true};",
    );
    const { report } = core.inventoryConfig({
      scope: 'machine',
      home,
      cwd: project,
      machinePath: path,
    });
    expect(report.machine_policy).toEqual({ tunnel: true, source: path });
    expect(report.result).toBe('ok');
  });
});
