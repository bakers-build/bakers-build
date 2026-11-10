import { describe, expect, it } from 'vitest';
import {
  applyMigrations,
  assertContiguous,
  BB_CONFIG_SCHEMA_VERSION,
  CONNECTION_MIGRATIONS,
  type ConnectionConfigMigration,
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

    it('is at v2 with the one-step chain from v1', () => {
      expect(CONNECTION_MIGRATIONS.map((m) => [m.from, m.to])).toEqual([
        [1, 2],
      ]);
      expect(BB_CONFIG_SCHEMA_VERSION).toBe(2);
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
