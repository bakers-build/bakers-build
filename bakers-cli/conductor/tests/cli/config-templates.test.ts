import { HOME_IMPORT_EXPRESSION_PATTERN } from '@bakers-build/core';
import { describe, expect, it } from 'vitest';
import {
  configImportExpression,
  renderCommittedConfig,
  renderGlobalConnection,
} from '../../src/cli/config-templates.js';

const base = {
  baseUrl: 'https://example.test',
  workspaceId: '11111111-1111-4111-8111-111111111111',
};

describe('rendered global connection', () => {
  it('keeps the client-credentials descriptor exactly as it was', () => {
    const text = renderGlobalConnection({
      ...base,
      clientId: 'bakers-cw',
      secret: 'private-value',
      authType: 'oauth2_client_credentials',
    });
    // Byte-stability guard (BB-496 review AC 3): the client-credentials
    // branch predates this ticket and must render its `type:` exactly as it
    // did before — a single-quoted literal, not JSON.stringify's double quotes.
    expect(text).toContain("type: 'oauth2_client_credentials'");
    expect(text).toContain(
      'client_id: "bakers-cw", client_secret: "private-value"',
    );
    expect(text).toContain('token_url: "https://example.test/oauth/token"');
  });

  it('renders the device-code descriptor without any client_secret key', () => {
    const text = renderGlobalConnection({
      ...base,
      clientId: 'bakers-cli',
      authType: 'oauth2_device_code',
    });
    expect(text).toContain('type: "oauth2_device_code"');
    expect(text).toContain('client_id: "bakers-cli"');
    expect(text).toContain(
      'device_authorization_url: "https://example.test/oauth/device_authorization"',
    );
    expect(text).not.toContain('client_secret');
    expect(text).not.toContain('undefined');
    expect(text).toContain('token_url: "https://example.test/oauth/token"');
  });
});

describe('rendered committed conductor config', () => {
  const base = {
    project: 'demo',
    hooks: {
      after_create: 'ddev init-worktree',
      after_done: 'ddev delete -Oy',
    },
  };

  it('imports the machine context through BB_HOME, never an absolute path', () => {
    const text = renderCommittedConfig(base);
    expect(text).toContain(
      '`${process.env.BB_HOME ?? `${process.env.HOME}/.bakers`}/machine.config.js`',
    );
    // The file is committed: a path from the machine that generated it breaks
    // every other checkout, and loadMachine() swallows the failure silently.
    expect(text).not.toContain('file://');
    expect(text).not.toContain('/home/');
    expect(text).not.toContain('/Users/');
  });

  it("renders an expression importConfig()'s recogniser still matches", () => {
    // The two drifted once already: the renderer moved to the BB_HOME-aware
    // form and core's import-config.ts kept matching only the old
    // `${process.env.HOME}/.bakers/…` shape, silently losing single-process
    // freshness for every committed config. Pinning them against each other
    // directly means changing one without the other fails here, not in CI.
    expect(
      HOME_IMPORT_EXPRESSION_PATTERN.test(
        configImportExpression('machine.config.js'),
      ),
    ).toBe(true);
    expect(
      HOME_IMPORT_EXPRESSION_PATTERN.test(
        configImportExpression('bakers.config.js'),
      ),
    ).toBe(true);
  });

  it('states nothing about claimable states', () => {
    // The claimable set belongs to the server's workflows. An absent `states`
    // already means "serve every claimable state", so a committed copy could
    // only drift away from it.
    expect(renderCommittedConfig(base)).not.toContain('states:');
  });

  it("writes exactly the operator's own hooks when supplied", () => {
    const text = renderCommittedConfig(base);
    expect(text).toContain('after_create: "ddev init-worktree"');
    expect(text).toContain('after_done: "ddev delete -Oy"');
  });

  it('writes only the supplied half of the hooks pair', () => {
    const text = renderCommittedConfig({
      project: 'demo',
      hooks: { after_create: 'make provision' },
    });
    expect(text).toContain('after_create: "make provision"');
    expect(text).not.toContain('after_done');
  });

  it('omits the hooks block entirely without an answer, and names no provisioning tool', () => {
    const text = renderCommittedConfig({ project: 'demo' });
    expect(text).not.toContain('hooks');
    expect(text).not.toContain('ddev');
    // An empty `hooks: {}` would be a statement about hooks where none was made.
    expect(text).not.toContain('hooks: {}');
  });

  it('omits the hooks block for an explicitly empty answer', () => {
    const text = renderCommittedConfig({
      project: 'demo',
      hooks: { after_create: '', after_done: '' },
    });
    expect(text).not.toContain('hooks');
  });

  it('still renders the project and the optional workspace', () => {
    expect(renderCommittedConfig(base)).toContain('project: "demo"');
    expect(
      renderCommittedConfig({ ...base, bakersWorkspace: 'acme' }),
    ).toContain('workspace: "acme"');
  });
});
