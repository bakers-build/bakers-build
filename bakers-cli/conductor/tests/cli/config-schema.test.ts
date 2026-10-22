import { describe, expect, it } from 'vitest';
import {
  addRendererPluginEntry,
  applyMigrations,
  assertContiguous,
  BB_CONFIG_SCHEMA_VERSION,
  CONNECTION_MIGRATIONS,
  type ConnectionConfigMigration,
  OAUTH2_PLUGIN_PACKAGE,
  RENDERER_PLUGIN_ENTRY,
  RENDERER_PLUGIN_PACKAGE,
  readConfigSchemaVersion,
  schemaVersionOf,
  stampSchemaVersionField,
  stampVersion,
} from '../../src/cli/config-schema.js';

// BB-216 (AC-8, unit): the connection-config schema-version machinery — the
// migration registry is contiguous and ends at CURRENT; applyMigrations walks a
// synthetic chain; the marker reader parses/absent-defaults.
describe('config-schema', () => {
  describe('CONNECTION_MIGRATIONS / BB_CONFIG_SCHEMA_VERSION', () => {
    it('is contiguous and ends at CURRENT', () => {
      expect(() => assertContiguous(CONNECTION_MIGRATIONS)).not.toThrow();
      const end = CONNECTION_MIGRATIONS.at(-1)?.to ?? 1;
      expect(end).toBe(BB_CONFIG_SCHEMA_VERSION);
    });

    it('derives CURRENT from the last migration (ships at v1 when empty)', () => {
      expect(BB_CONFIG_SCHEMA_VERSION).toBeGreaterThanOrEqual(1);
    });

    // BB-226: the chain's FIRST real method. CURRENT is derived, never
    // hardcoded — so this asserts the derivation, not the literal 2.
    it('registers the v1→v2 renderer migration and derives CURRENT from it', () => {
      const first = CONNECTION_MIGRATIONS[0];
      expect(first?.from).toBe(1);
      expect(first?.to).toBe(2);
      expect(first?.description).toContain(RENDERER_PLUGIN_PACKAGE);
      expect(BB_CONFIG_SCHEMA_VERSION).toBe(CONNECTION_MIGRATIONS.at(-1)?.to);
    });
  });

  // BB-226: the v1→v2 text transform. Pure text — the upgrade runner must
  // never execute a possibly side-effecting config module.
  describe('addRendererPluginEntry (v1 → v2)', () => {
    // The oauth2 entry carries its `with: { … }` block, because a real v1
    // config's did: `client_credentials` cannot be configured without one, and
    // two tests below drive the WHOLE chain over this fixture, where the v2→v3
    // step needs somewhere to put the single `bakers` identity.
    const v1 = [
      'export default {',
      '  schema_version: 1,',
      "  site: { base_url: 'https://x.test' },",
      '  plugins: [',
      '    {',
      "      plugin: '@dropsh/plugin-oauth2',",
      "      export: 'oauth2Plugin',",
      '      with: {',
      "        id: 'session',",
      "        type: 'oauth2_client_credentials',",
      "        scope: 'bb:session',",
      '      },',
      '    },',
      '  ],',
      '};',
      '',
    ].join('\n');

    it('inserts the entry as the FIRST plugins[] element, correctly indented', () => {
      const out = addRendererPluginEntry(v1);
      expect(out).toContain(`  plugins: [\n    ${RENDERER_PLUGIN_ENTRY}\n`);
      // The pre-existing oauth2 entry survives, after the new one.
      expect(out.indexOf(RENDERER_PLUGIN_PACKAGE)).toBeLessThan(
        out.indexOf('@dropsh/plugin-oauth2'),
      );
      expect(out).toContain("plugin: '@dropsh/plugin-oauth2'");
    });

    it('is idempotent: re-applying to already-migrated text is a no-op', () => {
      const once = addRendererPluginEntry(v1);
      expect(addRendererPluginEntry(once)).toBe(once);
      // …and so is the registered migration method itself.
      const apply = CONNECTION_MIGRATIONS[0]?.apply as (t: string) => string;
      expect(apply(apply(v1))).toBe(apply(v1));
    });

    it('ignores a mention in a whole-line comment (the template explains itself)', () => {
      const commented = `// the ${RENDERER_PLUGIN_PACKAGE} entry needs no export:\n${v1}`;
      const out = addRendererPluginEntry(commented);
      expect(out).toContain(`  plugins: [\n    ${RENDERER_PLUGIN_ENTRY}\n`);
    });

    it('leaves a config with no plugins[] array literal untouched', () => {
      const addonForm = `export default { site: {}, addons: ['x'] };\n`;
      expect(addRendererPluginEntry(addonForm)).toBe(addonForm);
    });

    it('is reachable through applyMigrations over the shipped chain', () => {
      const out = applyMigrations(v1, 1, BB_CONFIG_SCHEMA_VERSION);
      expect(out).toContain(RENDERER_PLUGIN_ENTRY);
    });

    it('re-stamps the in-body schema_version field with each step', () => {
      const out = applyMigrations(v1, 1, BB_CONFIG_SCHEMA_VERSION);
      expect(out).toContain(`schema_version: ${BB_CONFIG_SCHEMA_VERSION},`);
      expect(out).not.toContain('schema_version: 1,');
    });
  });

  // BB-391 (v2 → v3): ONE identity. Until now a connection declared two
  // scoped oauth2 providers — `session` (`bb:session`, the default) and `pm`
  // (`bakers:project_manager`) — and every write had to pick one. BB-359 moved
  // capability off site-wide job roles onto OG ranks, and the two entries
  // collapse into ONE `bakers` provider on ONE scope. One, not zero: the scope is
  // the capability ceiling for a client_credentials token, which is what every
  // bakers.build machine identity is.
  //
  // A MIGRATION, not a cutover (D3): operators have hand-edited these files
  // (a pinned `baseUrl`, an `addons[]` entry, a per-install `workspace_id`), so
  // the step is a pure text transform that preserves those values verbatim —
  // the upgrade runner must never execute a possibly side-effecting config.
  describe('the v2 → v3 one-identity collapse (BB-391)', () => {
    // Mirrors the shipped v2 connection config completely, including the
    // operator edits a real checkout accumulates: a pinned literal base URL,
    // a flat `addons[]` (BB-373) and the ambient `workspace_id` (BB-351).
    const v2 = [
      'export default {',
      '  schema_version: 2,',
      "  site: { base_url: baseUrl, jsonapi_prefix: local.jsonapi_prefix ?? '/jsonapi' },",
      '  workspace_id: workspaceId,',
      "  addons: ['@bakers-build/addon-bakers-ui-artifacts'],",
      '  plugins: [',
      "    { plugin: '@bakers-build/addon-essentials' },",
      '    {',
      "      plugin: '@dropsh/plugin-oauth2',",
      "      export: 'oauth2Plugin',",
      '      with: {',
      "        id: 'session',",
      '        default: true,',
      "        type: 'oauth2_client_credentials',",
      '        client_id: clientId,',
      '        client_secret: clientSecret,',
      // A template literal with escaped `\${`: this is the config file's
      // LITERAL text, not an interpolation of the test's own scope.
      `        token_url: \`\${baseUrl}/oauth/token\`,`,
      "        scope: 'bb:session',",
      '      },',
      '    },',
      '    {',
      "      plugin: '@dropsh/plugin-oauth2',",
      "      export: 'oauth2Plugin',",
      '      with: {',
      "        id: 'pm',",
      "        type: 'oauth2_client_credentials',",
      '        client_id: clientId,',
      '        client_secret: clientSecret,',
      // A template literal with escaped `\${`: this is the config file's
      // LITERAL text, not an interpolation of the test's own scope.
      `        token_url: \`\${baseUrl}/oauth/token\`,`,
      "        scope: 'bakers:project_manager',",
      '      },',
      '    },',
      '  ],',
      '};',
      '',
    ].join('\n');

    // The operator's pinned connection line, above the exported object.
    const preamble = "const baseUrl = 'https://ops.example.test';\n";

    const migrate = (text: string): string => applyMigrations(text, 2, 3);

    it('registers the v2→v3 migration and moves CURRENT to 3', () => {
      const step = CONNECTION_MIGRATIONS.find((m) => m.from === 2);
      expect(step?.to).toBe(3);
      expect(BB_CONFIG_SCHEMA_VERSION).toBe(CONNECTION_MIGRATIONS.at(-1)?.to);
      expect(() => assertContiguous(CONNECTION_MIGRATIONS)).not.toThrow();
    });

    it('leaves exactly one oauth2 entry, the default `bakers` provider', () => {
      const out = migrate(v2);
      expect(out.split('@dropsh/plugin-oauth2').length - 1).toBe(1);
      expect(out).toContain("id: 'bakers'");
      expect(out).toContain('default: true');
      expect(out).not.toContain("id: 'session'");
      expect(out).not.toContain("id: 'pm'");
      // dropsh's resolver has no sole-function auto-pick, so the surviving
      // entry still has to name its export.
      expect(out).toContain("export: 'oauth2Plugin'");
    });

    // The scope is KEPT, and exactly one of them. Zero was the original design
    // and a live control plane refuted it: for a `client_credentials` token —
    // every bakers.build machine identity — simple_oauth's Oauth2AccessPolicy
    // overwrites the calculated permissions with EXACTLY the scope's, so a
    // scopeless config either does not mint a token at all or silently inherits
    // the consumer's default scopes.
    it('keeps exactly one scope, the surviving one, and retires the other', () => {
      const out = migrate(v2);
      expect(out).toContain("scope: 'bb:session'");
      expect(out).not.toContain('bakers:project_manager');
      // One `scope:` key, because there is one provider left.
      expect(out.match(/\bscope:/g)).toHaveLength(1);
    });

    it('adds the scope when the surviving entry names none', () => {
      const scopeless = v2.replace(/^.*scope: 'bb:session',\r?\n/m, '');
      expect(scopeless).not.toContain('bb:session');
      const out = migrate(scopeless);
      expect(out).toContain("scope: 'bb:session'");
    });

    it('preserves the operator-set connection values verbatim', () => {
      const out = migrate(preamble + v2);
      expect(out).toContain("const baseUrl = 'https://ops.example.test';");
      expect(out).toContain('client_id: clientId,');
      expect(out).toContain('client_secret: clientSecret,');
      expect(out).toContain(`token_url: \`\${baseUrl}/oauth/token\`,`);
      expect(out).toContain('workspace_id: workspaceId,');
      expect(out).toContain(
        "addons: ['@bakers-build/addon-bakers-ui-artifacts'],",
      );
      // The renderer aggregator v1→v2 installed survives the collapse.
      expect(out).toContain(RENDERER_PLUGIN_PACKAGE);
    });

    it('re-stamps the in-body schema_version field to 3', () => {
      const out = migrate(v2);
      expect(out).toContain('schema_version: 3,');
      expect(out).not.toContain('schema_version: 2,');
    });

    it('is idempotent: re-applying the step to collapsed text is a no-op', () => {
      const step = CONNECTION_MIGRATIONS.find((m) => m.from === 2);
      const apply = step?.apply as (t: string) => string;
      const once = apply(v2);
      expect(apply(once)).toBe(once);
    });

    // The cases the first BB-391 round shipped untested. The collapse used the
    // entry's `id:` key as its ONLY anchor, so an entry naming none was returned
    // VERBATIM while the migration still reported success — writing a v3-stamped
    // config with no provider id and no `default: true`, which dropsh cannot
    // resolve and which therefore mints nothing. Silent success on a config the
    // migration did not actually migrate is the defect; each case below either
    // migrates correctly or throws.
    const step2 = (): ((t: string) => string) =>
      CONNECTION_MIGRATIONS.find((m) => m.from === 2)?.apply as (
        t: string,
      ) => string;

    it('inserts the id when the surviving entry names none', () => {
      const noId = v2.replace(/^.*id: 'session',\r?\n/m, '');
      expect(noId).not.toContain("id: 'session'");
      const out = migrate(noId);
      expect(out).toContain("id: 'bakers'");
      expect(out).toContain('default: true');
      expect(out).toContain("scope: 'bb:session'");
      expect(out.split(OAUTH2_PLUGIN_PACKAGE).length - 1).toBe(1);
    });

    it('adds the scope AND the id when the surviving entry names neither', () => {
      const bare = v2
        .replace(/^.*id: 'session',\r?\n/m, '')
        .replace(/^.*scope: 'bb:session',\r?\n/m, '');
      expect(bare).not.toContain('bb:session');
      const out = migrate(bare);
      expect(out).toContain("id: 'bakers'");
      expect(out).toContain("scope: 'bb:session'");
      expect(out.match(/\bscope:/g)).toHaveLength(1);
    });

    // An entry with no `id:` key and no `with: {` block has nowhere the three
    // v3 keys could go. Refusing loudly is the point: the alternative shipped
    // once already and reported success.
    it('throws on an oauth2 entry with nowhere to place the identity', () => {
      const unplaceable = [
        'export default {',
        '  schema_version: 2,',
        '  plugins: [',
        '    {',
        `      plugin: '${OAUTH2_PLUGIN_PACKAGE}',`,
        "      export: 'oauth2Plugin',",
        '    },',
        '  ],',
        '};',
        '',
      ].join('\n');
      expect(() => migrate(unplaceable)).toThrow(/oauth2/i);
    });

    it('is a no-op on an already-collapsed v3 entry', () => {
      const v3 = [
        'export default {',
        '  schema_version: 3,',
        '  plugins: [',
        '    {',
        `      plugin: '${OAUTH2_PLUGIN_PACKAGE}',`,
        "      export: 'oauth2Plugin',",
        '      with: {',
        "        id: 'bakers',",
        '        default: true,',
        "        type: 'oauth2_client_credentials',",
        "        scope: 'bb:session',",
        '      },',
        '    },',
        '  ],',
        '};',
        '',
      ].join('\n');
      expect(step2()(v3)).toBe(v3);
    });

    it('collapses a lone oauth2 entry that is already the only one', () => {
      const single = [
        'export default {',
        '  schema_version: 2,',
        '  plugins: [',
        `    { plugin: '${RENDERER_PLUGIN_PACKAGE}' },`,
        '    {',
        `      plugin: '${OAUTH2_PLUGIN_PACKAGE}',`,
        "      export: 'oauth2Plugin',",
        '      with: {',
        "        id: 'pm',",
        "        type: 'oauth2_client_credentials',",
        "        scope: 'bakers:project_manager',",
        '      },',
        '    },',
        '  ],',
        '};',
        '',
      ].join('\n');
      const out = migrate(single);
      expect(out).toContain("id: 'bakers'");
      expect(out).toContain('default: true');
      expect(out).toContain("scope: 'bb:session'");
      expect(out).not.toContain('bakers:project_manager');
    });

    it('leaves a config with no oauth2 entry exactly as it is', () => {
      const none = [
        'export default {',
        '  schema_version: 2,',
        '  plugins: [',
        `    { plugin: '${RENDERER_PLUGIN_PACKAGE}' },`,
        '  ],',
        '};',
        '',
      ].join('\n');
      expect(step2()(none)).toBe(none);
    });

    // The whole chain, v1 in: the renderer insert and the collapse compose.
    it('migrates a v1 config across the whole chain to one bakers provider', () => {
      const v1Auth = [
        'export default {',
        '  schema_version: 1,',
        "  site: { base_url: 'https://x.test' },",
        '  plugins: [',
        '    {',
        `      plugin: '${OAUTH2_PLUGIN_PACKAGE}',`,
        "      export: 'oauth2Plugin',",
        '      with: {',
        "        id: 'session',",
        "        type: 'oauth2_client_credentials',",
        "        scope: 'bb:session',",
        '      },',
        '    },',
        '  ],',
        '};',
        '',
      ].join('\n');
      const out = applyMigrations(v1Auth, 1, 3);
      expect(out).toContain(RENDERER_PLUGIN_PACKAGE);
      expect(out).toContain("id: 'bakers'");
      expect(out).toContain('default: true');
      expect(out).toContain("scope: 'bb:session'");
      expect(out).toContain('schema_version: 3,');
    });
  });

  describe('assertContiguous', () => {
    const chain: ConnectionConfigMigration[] = [
      { from: 1, to: 2, description: 'a', apply: (t) => t },
      { from: 2, to: 3, description: 'b', apply: (t) => t },
    ];

    it('accepts a synthetic contiguous chain ending at its current', () => {
      expect(() => assertContiguous(chain, 3)).not.toThrow();
    });

    it('rejects a gap in the chain', () => {
      const gapped: ConnectionConfigMigration[] = [
        { from: 1, to: 2, description: 'a', apply: (t) => t },
        { from: 3, to: 4, description: 'c', apply: (t) => t },
      ];
      expect(() => assertContiguous(gapped, 4)).toThrow(/gap|equal/);
    });

    it('rejects to !== from + 1', () => {
      const bad: ConnectionConfigMigration[] = [
        { from: 1, to: 3, description: 'x', apply: (t) => t },
      ];
      expect(() => assertContiguous(bad, 3)).toThrow(/from\+1/);
    });

    it('rejects a chain that does not end at CURRENT', () => {
      expect(() => assertContiguous(chain, 5)).toThrow(/ends at v3/);
    });
  });

  describe('applyMigrations', () => {
    it('walks a synthetic 2-entry chain v1→v3 in order', () => {
      const chain: ConnectionConfigMigration[] = [
        { from: 1, to: 2, description: 'add a', apply: (t) => `${t}\nA` },
        { from: 2, to: 3, description: 'add b', apply: (t) => `${t}\nB` },
      ];
      expect(applyMigrations('base', 1, 3, chain)).toBe('base\nA\nB');
    });

    it('applies a partial range only', () => {
      const chain: ConnectionConfigMigration[] = [
        { from: 1, to: 2, description: 'add a', apply: (t) => `${t}\nA` },
        { from: 2, to: 3, description: 'add b', apply: (t) => `${t}\nB` },
      ];
      expect(applyMigrations('base', 2, 3, chain)).toBe('base\nB');
    });

    it('is a no-op when from === to', () => {
      expect(applyMigrations('base', 1, 1, [])).toBe('base');
    });

    it('throws when the chain has no method for a version', () => {
      expect(() => applyMigrations('base', 1, 2, [])).toThrow(/no migration/);
    });
  });

  describe('readConfigSchemaVersion / schemaVersionOf', () => {
    it('parses the marker from text', () => {
      expect(
        schemaVersionOf('// @bakers-schema-version 7\nexport default {}'),
      ).toBe(7);
    });

    it('defaults to 0 when the marker is absent', () => {
      expect(schemaVersionOf('export default {}')).toBe(0);
    });

    it('returns 0 for a missing file', () => {
      expect(readConfigSchemaVersion('/no/such/file.js')).toBe(0);
    });
  });

  describe('stampSchemaVersionField', () => {
    it('rewrites the in-body field and is a no-op when absent', () => {
      expect(
        stampSchemaVersionField(
          'export default {\n  schema_version: 1,\n};',
          4,
        ),
      ).toBe('export default {\n  schema_version: 4,\n};');
      expect(stampSchemaVersionField('export default {};', 4)).toBe(
        'export default {};',
      );
    });
  });

  describe('stampVersion', () => {
    it('prepends the header and replaces an existing one', () => {
      expect(stampVersion('body', 2)).toBe('// @bakers-schema-version 2\nbody');
      expect(stampVersion('// @bakers-schema-version 1\nbody', 2)).toBe(
        '// @bakers-schema-version 2\nbody',
      );
    });
  });
});
it('requires cross-file planning before advancing machine-dependent connection ownership', () => {
  expect(() =>
    applyMigrations(
      'const baseUrl = machine.base_url; export default { schema_version:3, site:{base_url:baseUrl} };',
      3,
      4,
    ),
  ).toThrow(/ownership/);
});
