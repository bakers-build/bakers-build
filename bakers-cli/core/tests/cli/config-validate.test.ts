import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  checkConfigText,
  validateConfig,
} from '../../src/cli/config-validate.js';

const codes = (problems: { key: string; code: string }[]) =>
  problems.map((p) => `${p.code} ${p.key}`.trim()).sort();

describe('validateConfig: one schema per file kind', () => {
  it('accepts a complete project config', () => {
    expect(
      validateConfig('project', {
        schema_version: 1,
        project: { name: 'demo', workspace: 'Engineering' },
        addons: [
          '@bakers-build/addon-remote-drupal',
          { use: '@bakers-build/addon-ports', with: { services: [] } },
        ],
        permissions: {
          mode: 'sandbox',
          sandbox: { trusted_commands: ['git'] },
        },
        hooks: { after_create: 'make', provision_up: { deps: 'pnpm i' } },
        worktree: { use: '@bakers-build/addon-herdr', export: 'herdrWorktree' },
        states: ['working'],
        poll_interval_ms: 1000,
        select_agent: () => undefined,
      }),
    ).toEqual([]);
  });

  it('reports the description sample field by field', () => {
    const problems = validateConfig('project', {
      schema_version: 1,
      project: { name: 'demo' },
      poll_intervall_ms: 'fast',
      poll_interval_ms: 'fast',
      lease_seconds: -5,
      staets: ['working'],
      hooks: { after_craete: 'true' },
      permissions: { mode: 'sandbx' },
    });
    expect(codes(problems)).toEqual([
      'invalid_value lease_seconds',
      'invalid_value permissions.mode',
      'invalid_value poll_interval_ms',
      'unknown_key hooks.after_craete',
      'unknown_key poll_intervall_ms',
      'unknown_key staets',
    ]);
    expect(
      problems.find((p) => p.key === 'permissions.mode')?.message,
    ).toContain('sandbox, system, yolo');
  });

  it('requires the project identity and a machine id and label', () => {
    expect(codes(validateConfig('project', {}))).toEqual([
      'missing_required_key project',
    ]);
    expect(codes(validateConfig('machine', { tunnel: 'yes' }))).toEqual([
      'invalid_value tunnel',
      'missing_required_key label',
      'missing_required_key machine_id',
    ]);
  });

  it('checks the connection file in dropsh shape', () => {
    expect(
      validateConfig('connection', {
        site: { base_url: 'https://x.example', jsonapi_prefix: '/jsonapi' },
        plugins: [
          { plugin: '@dropsh/plugin-oauth2', export: 'oauth2Plugin', with: {} },
          { name: 'constructed', commands: [] },
        ],
      }),
    ).toEqual([]);
    expect(
      codes(
        validateConfig('connection', {
          site: { base_url: 'ftp:x' },
          plugins: [{ plugin: 'x', wiht: {} }],
        }),
      ),
    ).toEqual(['invalid_value site.base_url', 'unknown_key plugins[0].wiht']);
  });

  it('accepts a connection that names its server and a project that names none', () => {
    expect(
      validateConfig('connection', {
        site: { base_url: 'https://x.example' },
        server: { use: '@bakers-build/addon-remote-drupal' },
      }),
    ).toEqual([]);
    expect(
      validateConfig('project', {
        project: { name: 'demo' },
        addons: ['@bakers-build/addon-herdr'],
      }),
    ).toEqual([]);
  });

  it('rejects an old name as an unknown key', () => {
    expect(
      codes(
        validateConfig('project', {
          project: { name: 'demo' },
          bakers: { project: 'demo' },
          remote: { use: '@bakers-build/addon-remote-drupal' },
          selectAgent: () => undefined,
          addons: [{ use: 'x', name: 'x', options: {} }],
        }),
      ),
    ).toEqual([
      'unknown_key addons[0].name',
      'unknown_key addons[0].options',
      'unknown_key bakers',
      'unknown_key remote',
      'unknown_key selectAgent',
    ]);
    expect(
      codes(
        validateConfig('machine', {
          machine_id: 'm',
          label: 'l',
          agents: { default_agent: 'opus' },
        }),
      ),
    ).toEqual(['unknown_key agents.default_agent']);
  });
});

describe('checkConfigText: offline, without running the file', () => {
  it('reports computed values as not checked and keeps checking literals', () => {
    const problems = checkConfigText(
      'project',
      `import x from './x.js';
const local = {};
export default {
  project: { name: process.env.P ?? 'demo' },
  states: [...x],
  lease_seconds: 0,
  prompt: \`a \${local.b}\`,
  addons: ['a', ...x],
};`,
    );
    expect(codes(problems)).toEqual([
      'invalid_value lease_seconds',
      'invalid_value project.name',
      'not_checked addons',
      'not_checked prompt',
      'not_checked states',
    ]);
    expect(problems.find((p) => p.key === 'lease_seconds')?.line).toBe(6);
  });

  it('treats a spread in an object as not checked instead of missing keys', () => {
    expect(
      codes(
        checkConfigText(
          'machine',
          'const m = {}; export default { ...m, tunnel: 1 };',
        ),
      ),
    ).toEqual(['invalid_value tunnel', 'not_checked']);
  });
});

describe('addon options: checked offline from the package schema', () => {
  const fixture = () => {
    const root = mkdtempSync(join(tmpdir(), 'bb-addon-options-'));
    const pkg = (name: string, schema?: object) => {
      const dir = join(root, 'node_modules', '@fx', name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({
          name: `@fx/${name}`,
          type: 'module',
          exports: {
            '.': './index.js',
            ...(schema
              ? { './options.schema.json': './options.schema.json' }
              : {}),
          },
        }),
      );
      // Running addon code would fail the check: it must only read JSON.
      writeFileSync(
        join(dir, 'index.js'),
        'throw new Error("addon code ran");',
      );
      if (schema)
        writeFileSync(join(dir, 'options.schema.json'), JSON.stringify(schema));
    };
    pkg('colours', {
      $id: 'https://bakers.build/schema/fx-colours/options.schema.json',
      type: 'object',
      properties: { colour: { enum: ['red', 'blue'] } },
      additionalProperties: false,
    });
    pkg('harness', {
      $id: 'https://bakers.build/schema/fx-harness/options.schema.json',
      $ref: 'https://bakers.build/schema/harness-options.schema.json',
      properties: { extra: { type: 'string' } },
      unevaluatedProperties: false,
    });
    pkg('bare');
    return [pathToFileURL(`${root}/`).href];
  };

  it('reports option typos per entry and an addon without schema as not checked', () => {
    const problems = checkConfigText(
      'project',
      `export default {
  project: { name: 'demo' },
  addons: [
    { use: '@fx/colours', with: { color: 'red' } },
    { use: '@fx/harness', with: { permissions: 'sandbx', extra: 'x' } },
    { use: '@fx/bare', with: { a: 1 } },
    { use: '@fx/missing', with: {} },
    '@fx/colours',
    { use: '@fx/colours', with: { colour: 'blue' } },
  ],
};`,
      { bases: fixture() },
    );
    expect(codes(problems)).toEqual([
      'invalid_value addons[1].with.permissions',
      'options_not_checked addons[2].with',
      'options_not_checked addons[3].with',
      'unknown_key addons[0].with.color',
    ]);
  });

  it('checks a machine agents.catalog entry against its harness schema', () => {
    expect(
      codes(
        checkConfigText(
          'machine',
          `export default { machine_id: 'm', label: 'l',
  agents: { catalog: [{ harness: '@fx/harness', with: { modle: 'x' } }] } };`,
          { bases: fixture() },
        ),
      ),
    ).toEqual(['unknown_key agents.catalog[0].with.modle']);
  });
});

describe('runtime.image: project additions to the run image', () => {
  it('accepts packages and a fragment path, and names the key path of a wrong type', () => {
    expect(
      validateConfig('project', {
        project: { name: 'demo' },
        runtime: {
          image: {
            packages: { apt: ['jq'], npm: ['playwright@1.65.0'] },
            dockerfile: 'runtime.Dockerfile',
          },
        },
      }),
    ).toEqual([]);
    expect(
      codes(
        validateConfig('project', {
          project: { name: 'demo' },
          runtime: {
            image: {
              packages: { apt: 'jq', npm: [3], pip: [] },
              dockerfile: 7,
              tag: 'x',
            },
          },
        }),
      ),
    ).toEqual([
      'invalid_value runtime.image.dockerfile',
      'invalid_value runtime.image.packages.apt',
      'invalid_value runtime.image.packages.npm[0]',
      'unknown_key runtime.image.packages.pip',
      'unknown_key runtime.image.tag',
    ]);
  });
});

describe('runtime.image.dockerfile: a fragment under .bakers/', () => {
  const project = (dockerfile: string) =>
    `export default { project: { name: 'demo' }, runtime: { image: { dockerfile: ${JSON.stringify(dockerfile)} } } };`;
  const setup = () => {
    const root = mkdtempSync(join(tmpdir(), 'bb-fragment-'));
    const bakersDir = join(root, '.bakers');
    mkdirSync(join(bakersDir, 'image'), { recursive: true });
    writeFileSync(join(root, 'outside.Dockerfile'), 'RUN true\n');
    return { root, bakersDir };
  };
  const messages = (bakersDir: string, dockerfile: string) =>
    checkConfigText('project', project(dockerfile), { bakersDir })
      .filter((p) => p.key === 'runtime.image.dockerfile')
      .map((p) => p.message);

  it('accepts a fragment inside .bakers/ and checks nothing without one', () => {
    const { bakersDir } = setup();
    writeFileSync(
      join(bakersDir, 'image/run.Dockerfile'),
      '# FROM is fine in a comment\nRUN apt-get update \\\n  && echo user from\nENV A=1\n',
    );
    expect(messages(bakersDir, 'image/run.Dockerfile')).toEqual([]);
    expect(
      checkConfigText(
        'project',
        "export default { project: { name: 'demo' } };",
        {
          bakersDir,
        },
      ),
    ).toEqual([]);
  });

  it('refuses a path that leaves .bakers/: parent, absolute and symlink', () => {
    const { root, bakersDir } = setup();
    symlinkSync(
      join(root, 'outside.Dockerfile'),
      join(bakersDir, 'link.Dockerfile'),
    );
    for (const path of [
      '../outside.Dockerfile',
      join(root, 'outside.Dockerfile'),
      'link.Dockerfile',
    ])
      expect(messages(bakersDir, path)).toEqual([
        `${path} must stay inside .bakers/`,
      ]);
    expect(messages(bakersDir, 'missing.Dockerfile')).toEqual([
      'missing.Dockerfile was not found in .bakers/',
    ]);
  });

  it('refuses FROM and USER in any case, naming instruction and line', () => {
    const { bakersDir } = setup();
    writeFileSync(
      join(bakersDir, 'bad.Dockerfile'),
      'RUN true\n  user root\n# USER in a comment\nfrom node:22 AS x\n',
    );
    expect(messages(bakersDir, 'bad.Dockerfile')).toEqual([
      'bad.Dockerfile:2: USER is not allowed in a run image fragment',
      'bad.Dockerfile:4: FROM is not allowed in a run image fragment',
    ]);
  });
});
