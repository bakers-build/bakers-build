import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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
        schema_version: 2,
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
      schema_version: 2,
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

  it('answers an old name with its exact replacement', () => {
    const problems = validateConfig('project', {
      bakers: { project: 'demo' },
      remote: { plugin: '@bakers-build/addon-remote-drupal' },
      selectAgent: () => undefined,
      addons: [{ name: 'x', options: {} }],
    });
    expect(codes(problems)).toEqual([
      'renamed_key addons[0].name',
      'renamed_key addons[0].options',
      'renamed_key bakers',
      'renamed_key remote',
      'renamed_key selectAgent',
    ]);
    expect(problems.find((p) => p.key === 'bakers')?.message).toBe(
      'bakers was renamed: use project: { name, workspace }',
    );
    expect(problems.find((p) => p.key === 'remote')?.replacement).toBe(
      'server',
    );
    expect(
      codes(
        validateConfig('machine', {
          machine_id: 'm',
          label: 'l',
          agents: { default_agent: 'opus' },
        }),
      ),
    ).toEqual(['renamed_key agents.default_agent']);
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

describe('hook commands: renamed environment variables', () => {
  it('names the replacement of an old $BB_* variable in a literal hook', () => {
    const problems = validateConfig('project', {
      project: { name: 'demo' },
      hooks: {
        after_create: 'echo $BB_TICKET_UUID ${BB_STATE} $BB_E2E_KEEP',
        provision_up: { deps: 'echo $BB_RUN_UUID' },
      },
    });
    expect(codes(problems)).toEqual([
      'renamed_key hooks.after_create',
      'renamed_key hooks.provision_up.deps',
    ]);
    expect(problems[0]?.message).toBe(
      'BB_TICKET_UUID was renamed: use BAKERS_TICKET_UUID; BB_STATE was renamed: use BAKERS_STATE',
    );
  });
});

describe('prompt placeholders', () => {
  it('names the snake_case placeholder of an old one', () => {
    expect(
      validateConfig('project', {
        project: { name: 'demo' },
        prompt: 'Work {identifier} in run {runUuid} for {ticketUuid}',
      }).map((p) => p.message),
    ).toEqual([
      '{runUuid} was renamed: use {run_uuid}; {ticketUuid} was renamed: use {ticket_uuid}',
    ]);
  });
});
