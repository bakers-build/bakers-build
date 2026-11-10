// Every addon options.schema.json accepts a known-good `with` value and
// rejects a typo'd key. Lives in core because addons cannot resolve ajv.
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

const cli = new URL('../../', import.meta.url);
const load = (path: string): object =>
  JSON.parse(readFileSync(new URL(path, cli), 'utf8')) as object;

const cases: [addon: string, good: Record<string, unknown>][] = [
  ['auth-basic', { basic: 'dXNlcjpwYXNz' }],
  [
    'claude',
    {
      model: 'opus',
      effort: 'high',
      args: ['--verbose'],
      permissions: 'sandbox',
      sandbox: { allow_write: ['/tmp'], mcp_servers: {} },
      env_deny: ['SECRET'],
      measure: true,
    },
  ],
  ['codex', { model: 'gpt-5.6-sol', permissions: 'custom', config: { a: 1 } }],
  ['fake', { outcome: 'failed', marker_file: 'bakers-run.json' }],
  [
    'forge',
    {
      backend: { use: '@bakers-build/addon-forge-github', with: {} },
      merge: {
        main: { method: 'merge', delete_source: false },
        '*': { method: 'squash', delete_source: true },
      },
    },
  ],
  [
    'forge-github',
    {
      repository: 'acme/app',
      app_id: 12345,
      installation_id: '67890',
      private_key_env: 'FORGE_GITHUB_KEY',
    },
  ],
  [
    'forge-gitlab',
    {
      url: 'https://gitlab.example.org',
      project: 'group/app',
      token_env: 'FORGE_GITLAB_TOKEN',
    },
  ],
  ['grok', { model: 'grok-4.5', reasoning_effort: 'low', permissions: 'yolo' }],
  [
    'herdr',
    {
      command: 'claude',
      open: {
        command: 'bakers ui --ticket {identifier}',
        panes: [{ direction: 'right', command: 'lazygit' }],
        tab_label: '{identifier}',
      },
      default: { panel_label: '{title}' },
      states: {
        coding: { panes: [{ direction: 'down', command: 'git diff' }] },
      },
      launch_watch: { timeout_ms: 4000, start_timeout_ms: 60000 },
      worktree_dir: '.bakers-worktrees',
      base_branch: 'origin/main',
      auto_setup_merge: false,
    },
  ],
  ['herdr-core', { command: 'claude', launch_watch: { timeout_ms: 4000 } }],
  ['kimi', { model: 'k2', args: ['-y'] }],
  [
    'orca',
    {
      command: 'claude',
      open: { command: 'bakers ui --ticket {identifier}', title: '{title}' },
      default: { tab_label: '{identifier} · {state}' },
      adopt_timeout_ms: 35000,
      worktree_dir: '.bakers-worktrees',
      auto_setup_merge: true,
    },
  ],
  ['opencode', { model: 'm', permissions: 'yolo' }],
  [
    'pi',
    {
      permissions: 'custom',
      config: { extensions: ['builtin:x'] },
      provider: 'p',
      thinking: 'high',
      approve: true,
    },
  ],
  [
    'ports',
    {
      transport: { use: '@bakers-build/addon-ports-cloudflare-quick' },
      services: [{ key: 'docs', match: 'vitepress' }],
      all_node: true,
      claimers: ['@bakers-build/addon-ddev'],
    },
  ],
  [
    'ports-cloudflare',
    {
      account_id: 'a',
      tunnel_id: 't',
      zone_id: 'z',
      zone: 'preview.example.org',
      api_token: 'x',
    },
  ],
  [
    'ports-frp',
    {
      zone: 'preview.example.org',
      client_config_path: '/etc/frp/frpc.json',
      admin_port: 7400,
      admin_user: 'admin',
      admin_password: 's',
    },
  ],
  [
    'workspace-git',
    {
      branch_prefix: 'wt/',
      branch_template: '{branch_prefix}{key}',
      auto_setup_merge: true,
    },
  ],
];

describe('addon options schemas', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  ajv.addSchema(load('core/schema/harness-options.schema.json'));

  it.each(
    cases,
  )('%s accepts good options and rejects a typo', (addon, good) => {
    const schema = load(`addons/${addon}/options.schema.json`) as {
      $id: string;
    };
    expect(schema.$id).toBe(
      `https://bakers.build/schema/addon-${addon}/options.schema.json`,
    );
    const validate = ajv.compile(schema);
    expect(validate(good), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...good, modle: 'x' })).toBe(false);
  });

  it('forge backends take the conductor CLI login; a GitHub App still needs its ids', () => {
    const v = (addon: string) =>
      ajv.getSchema(
        `https://bakers.build/schema/addon-${addon}/options.schema.json`,
      ) ?? ajv.compile(load(`addons/${addon}/options.schema.json`));
    expect(v('forge-github')({ repository: 'a/b', auth: 'gh' })).toBe(true);
    expect(v('forge-github')({ repository: 'a/b' })).toBe(false);
    expect(v('forge-github')({ repository: 'a/b', auth: 'glab' })).toBe(false);
    expect(v('forge-gitlab')({ project: 'g/r', auth: 'glab' })).toBe(true);
  });
});
