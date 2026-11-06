// Browser form, dropsh and rank assertions for entity edit parity.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createBdd } from 'playwright-bdd';
import { expect, test } from '../../bdd.fixtures';
import { php } from '../../support/drush';
import { submitSaveForm } from '../../support/detail-cards';
import world from '../../support/contract-world.json';

const { Given, When, Then, After } = createBdd(test);

const BAKERS = resolve(__dirname, '../../../../bakers-cli/bin/bakers');

type FixtureName = keyof typeof world;

function fixtureMeta(name: string): { uuid: string; entityType: string } {
  const row = world[name as FixtureName];
  if (!row) {
    throw new Error(`Unknown recipe fixture: ${name}`);
  }
  return row;
}

/**
 * The browser form that edits the fixture. Workspace, project and group keep
 * their Settings form; a machine and a conductor are edited on their detail
 * page Identity card, whose own route answers 200 with update access, 403
 * without.
 */
function formPath(entityType: string, uuid: string): string {
  if (entityType === 'bb_workspace') {
    return php(
      `print "/" . \\Drupal::service("entity.repository")->loadEntityByUuid("bb_workspace", "${uuid}")->get("slug")->value . "/settings";`,
    );
  }
  const card: Record<string, string> = {
    bb_project: '/settings',
    bb_group: '/settings',
    bb_machine: '/card/identity',
    bb_conductor: '/card/identity',
  };
  if (!card[entityType]) {
    throw new Error(`No browser form for ${entityType}`);
  }
  return php(
    `print \\Drupal::service("entity.repository")->loadEntityByUuid("${entityType}", "${uuid}")->toUrl()->toString() . "${card[entityType]}";`,
  );
}

Then('the account {string} does not have permission {string}', async ({}, name: string, permission: string) => {
  const flag = php(
    `print (int) (($u = current(\\Drupal::entityTypeManager()->getStorage("user")->loadByProperties(["name" => "${name}"]))) && $u->hasPermission("${permission}"));`,
  );
  expect(flag, `${name} must lack ${permission}`).toBe('0');
});

Then('the account {string} has permission {string}', async ({}, name: string, permission: string) => {
  const flag = php(
    `print (int) (($u = current(\\Drupal::entityTypeManager()->getStorage("user")->loadByProperties(["name" => "${name}"]))) && $u->hasPermission("${permission}"));`,
  );
  expect(flag, `${name} must hold ${permission}`).toBe('1');
});

When(
  'the contract browser opens the form of fixture {string} twice with status {int}',
  async ({ page, apiClient }, name: string, status: number) => {
    const path = formPath(fixtureMeta(name).entityType, apiClient.fixtureId(name));
    await page.goto(path);
    const response = await page.goto(path);
    expect(response?.status(), page.url()).toBe(status);
  },
);

When('the contract browser reloads the form of fixture {string}', async ({ page, apiClient }, name: string) => {
  const path = formPath(fixtureMeta(name).entityType, apiClient.fixtureId(name));
  expect((await page.goto(path))?.status(), page.url()).toBe(200);
});

When('the contract browser fills {string} with {string} and saves', async ({ page }, field: string, value: string) => {
  const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Save', exact: true }) }).first();
  await expect(form).toBeVisible();
  await form.locator(`[name="${field}"]`).fill(value);
  // A card saves through htmx and swaps itself; a Settings form loads a page.
  await submitSaveForm(page, form, form.getByRole('button', { name: 'Save', exact: true }));
});

Then('the contract field {string} has value {string}', async ({ page }, field: string, value: string) => {
  await expect(page.locator(`[name="${field}"]`)).toHaveValue(value);
});

function redact(text: string): string {
  return text
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[token]')
    .replace(/Bb-test-client-426!/g, '[secret]')
    .replace(/Bb-test-login-426!/g, '[secret]');
}

let dropshHome = '';
let dropshConfig = '';
let lastDropsh = { status: null as number | null, stdout: '', stderr: '' };

function runBb(args: string[], home: string): typeof lastDropsh {
  const result = spawnSync(BAKERS, args, {
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: join(home, '.config'),
      NODE_OPTIONS: '--use-system-ca',
    },
    timeout: 60000,
  });
  return {
    status: result.status,
    stdout: redact(result.stdout ?? ''),
    stderr: redact(result.stderr ?? result.error?.message ?? ''),
  };
}

function writeDropshConfig(base: string, account: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'bakers-edit-dropsh-'));
  const config = join(dir, 'bakers.config.js');
  const clients: Record<string, string> = {
    'fixture-lead': 'bakers-e2e-session-lead',
    'north-contributor': 'bakers-e2e-session-member',
    'no-bakery': 'bakers-e2e-session-stranger',
    'fixture-conductor-owner': 'bakers-conductor-owner-e2e',
  };
  const clientId = clients[account];
  if (!clientId) {
    throw new Error(`No session consumer for ${account}`);
  }
  const oauth = `{
        plugin: '@dropsh/plugin-oauth2',
        export: 'oauth2Plugin',
        with: {
          id: 'bakers',
          default: true,
          type: 'oauth2_client_credentials',
          client_id: ${JSON.stringify(clientId)},
          client_secret: 'Bb-test-client-426!',
          token_url: ${JSON.stringify(`${base}/oauth/token`)},
          scope: 'bb:session',
        },
      }`;
  writeFileSync(
    config,
    `// @bakers-schema-version 1
export default {
  schema_version: 1,
  site: { base_url: ${JSON.stringify(base)}, jsonapi_prefix: '/jsonapi' },
  plugins: [
    { plugin: '@bakers-build/addon-essentials' },
    ${oauth},
  ],
};
`,
  );
  dropshHome = dir;
  dropshConfig = config;
  return dir;
}

Given('dropsh uses a session token for {string}', async ({ baseURL }, account: string) => {
  if (dropshHome) {
    rmSync(dropshHome, { recursive: true, force: true });
  }
  const base = String(baseURL).replace(/\/$/, '');
  writeDropshConfig(base, account);
  lastDropsh = runBb(['dropsh', '--config', dropshConfig, 'auth', 'login'], dropshHome);
  expect(lastDropsh.status, `${lastDropsh.stderr}\n${lastDropsh.stdout}`).toBe(0);
});

When(
  'dropsh updates {string} with {string} {string}',
  async ({ apiClient }, resource: string, flag: string, value: string) => {
    lastDropsh = runBb(
      ['dropsh', '--config', dropshConfig, '--yes', '--format', 'json', 'update', apiClient.resolve(resource), flag, value],
      dropshHome,
    );
  },
);

Then('dropsh exits 0', async () => {
  expect(lastDropsh.status, `${lastDropsh.stderr}\n${lastDropsh.stdout}`).toBe(0);
});

Then('dropsh reports a server 403', async () => {
  const output = `${lastDropsh.stderr}\n${lastDropsh.stdout}`;
  expect(lastDropsh.status, output).not.toBe(0);
  expect(output).toMatch(/403/);
});

After({ tags: '@feature:entity-edit-access' }, async ({ apiClient }) => {
  if (dropshHome) {
    rmSync(dropshHome, { recursive: true, force: true });
    dropshHome = '';
    dropshConfig = '';
  }
  await apiClient.identify('site-admin');
  const restores: Array<{ path: string; document: object }> = [
    {
      path: '/jsonapi/bb_workspace/bb_workspace/{workspace.home}',
      document: {
        data: {
          type: 'bb_workspace--bb_workspace',
          id: '{workspace.home}',
          attributes: { description: '' },
        },
      },
    },
    {
      path: '/jsonapi/bb_group/bb_group/{group.edit}',
      document: {
        data: { type: 'bb_group--bb_group', id: '{group.edit}', attributes: { name: 'API edit group' } },
      },
    },
    {
      path: '/jsonapi/bb_project/bb_project/{project.edit}',
      document: {
        data: { type: 'bb_project--bb_project', id: '{project.edit}', attributes: { name: 'API edit project' } },
      },
    },
    {
      path: '/jsonapi/bb_machine/bb_machine/{machine.edit}',
      document: {
        data: {
          type: 'bb_machine--bb_machine',
          id: '{machine.edit}',
          attributes: { name: 'API edit host', max_parallel: 4, current_load: 0 },
        },
      },
    },
    {
      path: '/jsonapi/bb_conductor/bb_conductor/{conductor.edit}',
      document: {
        data: {
          type: 'bb_conductor--bb_conductor',
          id: '{conductor.edit}',
          attributes: { label: 'API edit conductor', status: 'online', active: true },
        },
      },
    },
  ];
  for (const row of restores) {
    await apiClient.send('PATCH', row.path, JSON.stringify(row.document));
  }
});
