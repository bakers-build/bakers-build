import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ADDON_RENAME_BAK_SUFFIX,
  CORE_PLUGINS_BARREL_EXPORTS,
  migrateAddonNames,
  runAddonRenameMigration,
} from '../../src/cli/migrate-addon-names.js';

// BB-224 AC-9b (Finding 8b, spec v3 decision 17): `bakers upgrade` migrates the
// addon package rename in the user's project `./.bakers/` AND home `~/.bakers/`
// configs — `@bakers-build/plugin-*` → `@bakers-build/addon-*` in the bare-string and both
// descriptor forms, plus the deleted `@bakers-build/core/builtins` preset → the two
// addons that replaced it. Idempotent; `--dry-run` writes nothing.
//
// Every test drives an INJECTED tmp `cwd`/`home` — the developer's real
// `~/.bakers/` is never read or written.

// A pre-BB-224 ENGINE config: bare-string + `{ use }` + `{ plugin }` forms,
// hand-written comments and formatting the pass must not disturb.
const LEGACY_ENGINE = `// my hand-written engine config — keep this comment
export default {
  project: 'p',
  machine_id: 'm',
  // the drupal remote used to come from the core builtins preset
  addons: [
    '@bakers-build/core/builtins',
    { use: '@bakers-build/plugin-herdr', with: { hooks: { after_create: 'ddev init-worktree' } } },
    { use: '@bakers-build/plugin-codex', with: { model: 'gpt-5' } },
  ],
  // the remote slot named the (now deleted) core host barrel, as the pre-BB-224
  // project docs prescribed
  remote: { plugin: '@bakers-build/core/plugins', export: 'drupalRemote' },
  workspace: { plugin: '@bakers-build/plugin-herdr', export: 'herdrWorkspace' },
  agent: { plugin: "@bakers-build/plugin-claude" },
};
`;

// A pre-BB-224 CONNECTION config using the legacy `plugins[]` array.
const LEGACY_CONNECTION = `export default {
  site: { base_url: 'https://x.test' },
  plugins: [
    { plugin: '@bakers-build/core/builtins', with: { basic: 'dXNlcjpwdw==' } },
    '@bakers-build/plugin-essentials',
    { plugin: '@bakers-build/plugin-bakers-ui' },
  ],
};
`;

describe('migrateAddonNames (text transform)', () => {
  it('rewrites the bare-string form', () => {
    const { text, count } = migrateAddonNames(
      `export default { addons: ['@bakers-build/plugin-herdr'] };\n`,
      'engine',
    );
    expect(count).toBe(1);
    expect(text).toContain(`'@bakers-build/addon-herdr'`);
  });

  it('rewrites the `{ use }` and `{ plugin }` descriptor forms, single + double quoted', () => {
    const { text, count } = migrateAddonNames(
      `export default { addons: [{ use: '@bakers-build/plugin-codex' }, { plugin: "@bakers-build/plugin-claude" }] };\n`,
      'engine',
    );
    expect(count).toBe(2);
    expect(text).toContain(`use: '@bakers-build/addon-codex'`);
    expect(text).toContain(`plugin: "@bakers-build/addon-claude"`);
  });

  it('rewrites a subpath specifier (`/preset`) and keeps the subpath', () => {
    const { text } = migrateAddonNames(
      `import { commands } from '@bakers-build/plugin-dropsh/preset';\n`,
      'connection',
    );
    expect(text).toContain(`'@bakers-build/addon-dropsh/preset'`);
  });

  it('covers all 14 renamed addon packages', () => {
    const names = [
      'auth-basic',
      'claude',
      'codex',
      'deployment',
      'dropsh',
      'essentials',
      'fake',
      'bakers-ui',
      'herdr',
      'kimi',
      'opencode',
      'pi',
      'remote-drupal',
      'workspace-git',
    ];
    const src = `export default { addons: [${names.map((n) => `'@bakers-build/plugin-${n}'`).join(',\n')}] };`;
    const { text, count } = migrateAddonNames(src, 'engine');
    expect(count).toBe(14);
    expect(text).not.toContain('@bakers-build/plugin-');
  });

  // BB-230 re-scoped this case: the barrel DESCRIPTOR
  // (`{ plugin: '@bakers-build/bakers/plugins', export: 'drupalRemote' }`) is now
  // migrated on purpose — it is root cause 1, and its own coverage lives in the
  // BB-230 block below. What stays untouched is everything that is not a
  // descriptor: `*Plugin` identifiers, the `plugins:`/`addons:` config KEYS, and a
  // bare `import … from '<barrel>'` statement (no adjacent `export:` ⇒ no
  // knowable target).
  it('never touches *Plugin identifiers, the plugins[]/addons[] KEYS or a bare barrel import', () => {
    const src = `import type { RemotePlugin, BbCommandPlugin } from '@bakers-build/conductor/contract';
import { drupalRemote } from '@bakers-build/bakers/plugins';
import { gitWorkspace } from '@bakers-build/core/plugins';
const herdrExecutorPlugin = 1;
export default { plugins: [], addons: [], remote: drupalRemote() };
`;
    const { text, count } = migrateAddonNames(src, 'engine');
    expect(count).toBe(0);
    expect(text).toBe(src);
  });

  it('leaves an UNKNOWN @bakers-build/plugin-* specifier alone (closed rename set)', () => {
    const src = `export default { addons: ['@bakers-build/plugin-not-a-real-addon'] };\n`;
    const { text, count } = migrateAddonNames(src, 'engine');
    expect(count).toBe(0);
    expect(text).toBe(src);
  });

  describe('@bakers-build/core/builtins → the two addons that replaced it', () => {
    it('an engine `addons[]` bare entry → @bakers-build/addon-remote-drupal', () => {
      const { text } = migrateAddonNames(
        `export default { addons: ['@bakers-build/core/builtins'] };\n`,
        'engine',
      );
      expect(text).toContain(`'@bakers-build/addon-remote-drupal'`);
    });

    it('an entry carrying a `basic` token → @bakers-build/addon-auth-basic', () => {
      const { text } = migrateAddonNames(
        `export default { addons: [{ use: '@bakers-build/core/builtins', with: { basic: t } }] };\n`,
        'connection',
      );
      expect(text).toContain(`'@bakers-build/addon-auth-basic'`);
    });

    it('a multi-line `basic` entry is still detected', () => {
      const { text } = migrateAddonNames(
        `export default {
  addons: [
    {
      use: '@bakers-build/core/builtins',
      with: { basic: { user: 'u', pass: 'p' } },
    },
  ],
};
`,
        'connection',
      );
      expect(text).toContain(`'@bakers-build/addon-auth-basic'`);
    });

    it('a bare entry in a CONNECTION config → @bakers-build/addon-auth-basic', () => {
      const { text } = migrateAddonNames(
        `export default { addons: ['@bakers-build/core/builtins'] };\n`,
        'connection',
      );
      expect(text).toContain(`'@bakers-build/addon-auth-basic'`);
    });

    it('a LEGACY engine file maps its `plugins[]` entry to auth-basic and its `addons[]` entry to remote-drupal', () => {
      const { text, count } = migrateAddonNames(
        `export default {
  site: { base_url: 'https://x.test' },
  addons: ['@bakers-build/core/builtins'],
  plugins: ['@bakers-build/core/builtins'],
};
`,
        'engine',
      );
      expect(count).toBe(2);
      expect(text).toContain(`addons: ['@bakers-build/addon-remote-drupal']`);
      expect(text).toContain(`plugins: ['@bakers-build/addon-auth-basic']`);
    });
  });

  // BB-224 follow-up: `@bakers-build/core/plugins` is deleted with NO back-compat
  // subpath (unlike `@bakers-build/bakers/plugins`), and the pre-BB-224 project docs
  // told configs to name exactly it — so the pass must migrate it too. The target
  // is derived per `export:` name from the barrel's own export list.
  describe('@bakers-build/core/plugins → the addon owning the named export', () => {
    it('maps drupalRemote and DROPS the redundant export: (addon default-exports it)', () => {
      const { text, count } = migrateAddonNames(
        `export default { remote: { plugin: '@bakers-build/core/plugins', export: 'drupalRemote' } };\n`,
        'engine',
      );
      expect(count).toBe(1);
      expect(text).toBe(
        `export default { remote: { plugin: '@bakers-build/addon-remote-drupal' } };\n`,
      );
    });

    it('maps gitWorkspace and basicAuthProvider, dropping export: for both', () => {
      const { text } = migrateAddonNames(
        `export default {
  workspace: { plugin: '@bakers-build/core/plugins', export: 'gitWorkspace' },
  plugins: [{ plugin: "@bakers-build/core/plugins", export: "basicAuthProvider" }],
};
`,
        'engine',
      );
      expect(text).toContain(
        `workspace: { plugin: '@bakers-build/addon-workspace-git' },`,
      );
      expect(text).toContain(`{ plugin: "@bakers-build/addon-auth-basic" }`);
      expect(text).not.toContain('export:');
    });

    it('maps the fakes to @bakers-build/addon-fake but KEEPS export: (no default export there)', () => {
      const { text, count } = migrateAddonNames(
        `export default {
  remote: { plugin: '@bakers-build/core/plugins', export: 'fakeRemote' },
  workspace: { plugin: '@bakers-build/core/plugins', export: 'fakeWorkspace' },
};
`,
        'engine',
      );
      expect(count).toBe(2);
      expect(text).toContain(
        `remote: { plugin: '@bakers-build/addon-fake', export: 'fakeRemote' },`,
      );
      expect(text).toContain(
        `workspace: { plugin: '@bakers-build/addon-fake', export: 'fakeWorkspace' },`,
      );
    });

    it('handles the `use:` key and the reversed key order', () => {
      const { text, count } = migrateAddonNames(
        `export default { addons: [{ export: 'drupalRemote', use: '@bakers-build/core/plugins' }] };\n`,
        'engine',
      );
      expect(count).toBe(1);
      expect(text).toContain(`use: '@bakers-build/addon-remote-drupal'`);
      expect(text).not.toContain('export:');
    });

    it('keeps a MULTI-LINE descriptor line-local: the specifier is rewritten, export: stays', () => {
      const src = `export default {
  remote: {
    plugin: '@bakers-build/core/plugins',
    export: 'drupalRemote',
  },
};
`;
      const { text, count } = migrateAddonNames(src, 'engine');
      expect(count).toBe(1);
      expect(text).toContain(`plugin: '@bakers-build/addon-remote-drupal',`);
      // `drupalRemote` is ALSO a named export of the addon, so this still resolves
      expect(text).toContain(`export: 'drupalRemote',`);
      // the line-count invariant the report diff relies on
      expect(text.split('\n')).toHaveLength(src.split('\n').length);
    });

    it('leaves an UNMAPPED export: name alone rather than guessing a target', () => {
      const src = `export default {
  remote: { plugin: '@bakers-build/core/plugins', export: 'selectRemote' },
  workspace: { plugin: '@bakers-build/core/plugins', export: 'notAnExportEver' },
};
`;
      const { text, count } = migrateAddonNames(src, 'engine');
      expect(count).toBe(0);
      expect(text).toBe(src);
    });

    it('leaves a barrel occurrence with NO adjacent export: alone (target unknowable)', () => {
      const src = `// see \`@bakers-build/core/plugins\` for the old barrel
export default {
  addons: ['@bakers-build/core/plugins'],
  workspace: { plugin: '@bakers-build/addon-herdr', export: 'herdrWorkspace' },
};
`;
      const { text, count } = migrateAddonNames(src, 'engine');
      expect(count).toBe(0);
      expect(text).toBe(src);
    });

    // The mapping is only as good as its agreement with the ADDON SOURCES: each
    // target must really be a workspace addon, must really export that name, and
    // `defaultExport` must match whether it is that package's default export.
    it('agrees with the addon sources: package exists, exports the name, defaultExport is accurate', () => {
      const addonsRoot = join(import.meta.dirname, '..', '..', '..', 'addons');
      for (const [name, { target, defaultExport }] of Object.entries(
        CORE_PLUGINS_BARREL_EXPORTS,
      )) {
        expect(target.startsWith('@bakers-build/addon-')).toBe(true);
        const dir = join(addonsRoot, target.slice('@bakers-build/addon-'.length));
        const manifest = JSON.parse(
          readFileSync(join(dir, 'package.json'), 'utf8'),
        ) as { name: string };
        expect(manifest.name).toBe(target);
        const index = readFileSync(join(dir, 'src', 'index.ts'), 'utf8');
        expect(index).toContain(name);
        expect(index.includes(`export default ${name};`)).toBe(defaultExport);
      }
    });

    it('is idempotent — a second pass over the migrated text is a no-op', () => {
      const src = `export default {
  remote: { plugin: '@bakers-build/core/plugins', export: 'drupalRemote' },
  workspace: { plugin: '@bakers-build/core/plugins', export: 'fakeWorkspace' },
};
`;
      const once = migrateAddonNames(src, 'engine');
      const twice = migrateAddonNames(once.text, 'engine');
      expect(twice.count).toBe(0);
      expect(twice.text).toBe(once.text);
    });
  });

  // BB-230 (RED, root cause 1): the pass ALSO has to migrate the
  // `@bakers-build/bakers/plugins` host barrel, which it deliberately skipped. The
  // barrel is exported ONLY by the meta package `@bakers-build/bakers`, which is the
  // workspace's leaf sink and therefore absent from a dev-clone install — so a
  // config naming it is unresolvable from exactly the install the `bakers` shim
  // prefers, while its sibling `addon-*` slots resolve fine. Same closed set,
  // same drop-the-redundant-`export:` rule as the `@bakers-build/core/plugins` block
  // above.
  describe('@bakers-build/bakers/plugins → the addon owning the named export (BB-230)', () => {
    it('AC-1: maps drupalRemote and DROPS the redundant export:', () => {
      const { text, count } = migrateAddonNames(
        `export default { remote: { plugin: '@bakers-build/bakers/plugins', export: 'drupalRemote' } };\n`,
        'engine',
      );
      expect(count).toBe(1);
      expect(text).toBe(
        `export default { remote: { plugin: '@bakers-build/addon-remote-drupal' } };\n`,
      );
    });

    it('AC-2: maps gitWorkspace, basicAuthProvider and the fakes to their addons', () => {
      const { text, count } = migrateAddonNames(
        `export default {
  workspace: { plugin: '@bakers-build/bakers/plugins', export: 'gitWorkspace' },
  plugins: [{ plugin: "@bakers-build/bakers/plugins", export: "basicAuthProvider" }],
  remote: { plugin: '@bakers-build/bakers/plugins', export: 'fakeRemote' },
  fallback: { plugin: '@bakers-build/bakers/plugins', export: 'fakeWorkspace' },
};
`,
        'engine',
      );
      expect(count).toBe(4);
      expect(text).toContain(
        `workspace: { plugin: '@bakers-build/addon-workspace-git' },`,
      );
      expect(text).toContain(`{ plugin: "@bakers-build/addon-auth-basic" }`);
      // addon-fake ships the triple as NAMED exports, so `export:` survives
      expect(text).toContain(
        `remote: { plugin: '@bakers-build/addon-fake', export: 'fakeRemote' },`,
      );
      expect(text).toContain(
        `fallback: { plugin: '@bakers-build/addon-fake', export: 'fakeWorkspace' },`,
      );
      expect(text).not.toContain('@bakers-build/bakers/plugins');
    });

    it('AC-2: handles the `use:` key and the reversed key order', () => {
      const { text, count } = migrateAddonNames(
        `export default { addons: [{ export: 'drupalRemote', use: '@bakers-build/bakers/plugins' }] };\n`,
        'engine',
      );
      expect(count).toBe(1);
      expect(text).toContain(`use: '@bakers-build/addon-remote-drupal'`);
      expect(text).not.toContain('export:');
    });

    it('AC-3: an export: name outside the closed set is left BYTE-untouched', () => {
      const src = `export default {
  remote: { plugin: '@bakers-build/bakers/plugins', export: 'selectRemote' },
  workspace: { plugin: '@bakers-build/bakers/plugins', export: 'loadInstructions' },
  other: { plugin: '@bakers-build/bakers/plugins', export: 'notAnExportEver' },
};
`;
      const { text, count } = migrateAddonNames(src, 'engine');
      expect(count).toBe(0);
      expect(text).toBe(src);
    });

    it('AC-3: a barrel mention with NO adjacent export: is left alone (target unknowable)', () => {
      const src = `// the \`@bakers-build/bakers/plugins\` back-compat barrel still exists
export default {
  addons: ['@bakers-build/bakers/plugins'],
  workspace: { plugin: '@bakers-build/addon-herdr', export: 'herdrWorkspace' },
};
`;
      const { text, count } = migrateAddonNames(src, 'engine');
      expect(count).toBe(0);
      expect(text).toBe(src);
    });

    it('keeps a MULTI-LINE descriptor line-local (report-diff invariant)', () => {
      const src = `export default {
  remote: {
    plugin: '@bakers-build/bakers/plugins',
    export: 'drupalRemote',
  },
};
`;
      const { text, count } = migrateAddonNames(src, 'engine');
      expect(count).toBe(1);
      expect(text).toContain(`plugin: '@bakers-build/addon-remote-drupal',`);
      expect(text).toContain(`export: 'drupalRemote',`);
      expect(text.split('\n')).toHaveLength(src.split('\n').length);
    });

    it('is idempotent — a second pass over the migrated text is a no-op', () => {
      const src = `export default {
  remote: { plugin: '@bakers-build/bakers/plugins', export: 'drupalRemote' },
  workspace: { plugin: '@bakers-build/bakers/plugins', export: 'gitWorkspace' },
};
`;
      const once = migrateAddonNames(src, 'engine');
      const twice = migrateAddonNames(once.text, 'engine');
      expect(twice.count).toBe(0);
      expect(twice.text).toBe(once.text);
    });
  });
});

describe('runAddonRenameMigration rename pass', () => {
  let cwd: string;
  let home: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'bakers-rename-cwd-'));
    home = mkdtempSync(join(tmpdir(), 'bakers-rename-home-'));
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  /** Seed a `.bakers/` dir with legacy configs; returns the dir. */
  const seedLegacy = (
    root: string,
    files: Record<string, string> = {
      'conductor.config.js': LEGACY_ENGINE,
      'bakers.config.js': LEGACY_CONNECTION,
    },
  ) => {
    const dir = join(root, '.bakers');
    mkdirSync(dir, { recursive: true });
    for (const [name, body] of Object.entries(files)) {
      writeFileSync(join(dir, name), body, 'utf8');
    }
    return dir;
  };

  it('rewrites the PROJECT configs: engine addons[] + connection plugins[], all three forms', () => {
    const dir = seedLegacy(cwd);
    const res = runAddonRenameMigration({ bakersDirs: [dir] });
    expect(res.changed).toBe(true);

    const engine = readFileSync(join(dir, 'conductor.config.js'), 'utf8');
    expect(engine).not.toContain('@bakers-build/plugin-');
    expect(engine).not.toContain('@bakers-build/core/builtins');
    expect(engine).toContain(`'@bakers-build/addon-remote-drupal'`); // builtins, engine
    expect(engine).toContain(`use: '@bakers-build/addon-herdr'`); // { use }
    expect(engine).toContain(`plugin: '@bakers-build/addon-herdr'`); // { plugin }
    expect(engine).toContain(`plugin: "@bakers-build/addon-claude"`);
    // the deleted core host barrel → the addon that owns `drupalRemote`, with the
    // now-redundant `export:` dropped
    expect(engine).not.toContain('@bakers-build/core/plugins');
    expect(engine).toContain(
      `remote: { plugin: '@bakers-build/addon-remote-drupal' },`,
    );
    // hand-written comments + the `export:` selector survive untouched.
    expect(engine).toContain(
      '// my hand-written engine config — keep this comment',
    );
    expect(engine).toContain(`export: 'herdrWorkspace'`);

    const conn = readFileSync(join(dir, 'bakers.config.js'), 'utf8');
    expect(conn).not.toContain('@bakers-build/plugin-');
    expect(conn).toContain(`'@bakers-build/addon-auth-basic'`); // builtins + basic
    expect(conn).toContain(`'@bakers-build/addon-essentials'`); // bare string
    expect(conn).toContain(`plugin: '@bakers-build/addon-bakers-ui'`);
  });

  it('rewrites the HOME configs too (~/.bakers/), through the rename service', () => {
    seedLegacy(cwd);
    const homeDir = seedLegacy(home);
    const report = runAddonRenameMigration({
      bakersDirs: [join(cwd, '.bakers'), homeDir],
    });
    expect(report.changed).toBe(true);

    for (const f of ['conductor.config.js', 'bakers.config.js']) {
      const text = readFileSync(join(homeDir, f), 'utf8');
      expect(text).not.toContain('@bakers-build/plugin-');
      expect(text).not.toContain('@bakers-build/core/builtins');
    }
    // …and the project ones, in the same run.
    expect(
      readFileSync(join(cwd, '.bakers', 'conductor.config.js'), 'utf8'),
    ).not.toContain('@bakers-build/plugin-');
    expect(
      report.actions.some(
        (a) => a.startsWith('rewrote') && a.includes('.bakers'),
      ),
    ).toBe(true);
  });

  it('covers a `<variant>.conductor.config.js` (BB-137 naming), not just the default file', () => {
    const dir = seedLegacy(cwd, {
      'shop.conductor.config.js': LEGACY_ENGINE,
      // near-misses the loader ignores → the pass must ignore them too
      'myconductor.config.js': LEGACY_ENGINE,
      'vite.config.js': LEGACY_ENGINE,
    });
    runAddonRenameMigration({ bakersDirs: [dir] });
    expect(
      readFileSync(join(dir, 'shop.conductor.config.js'), 'utf8'),
    ).not.toContain('@bakers-build/plugin-');
    expect(readFileSync(join(dir, 'myconductor.config.js'), 'utf8')).toBe(
      LEGACY_ENGINE,
    );
    expect(readFileSync(join(dir, 'vite.config.js'), 'utf8')).toBe(
      LEGACY_ENGINE,
    );
  });

  it('is idempotent — a second run leaves every file BYTE-unchanged and reports nothing', () => {
    const dir = seedLegacy(cwd);
    runAddonRenameMigration({ bakersDirs: [dir] });
    const after = {
      engine: readFileSync(join(dir, 'conductor.config.js'), 'utf8'),
      conn: readFileSync(join(dir, 'bakers.config.js'), 'utf8'),
    };

    const second = runAddonRenameMigration({ bakersDirs: [dir] });
    expect(second.changed).toBe(false);
    expect(second.actions).toEqual([]);
    expect(readFileSync(join(dir, 'conductor.config.js'), 'utf8')).toBe(
      after.engine,
    );
    expect(readFileSync(join(dir, 'bakers.config.js'), 'utf8')).toBe(after.conn);
  });

  it('a config already on addon-* is never rewritten and gets no backup', () => {
    const dir = seedLegacy(cwd, {
      'conductor.config.js': `export default { addons: ['@bakers-build/addon-remote-drupal', { use: '@bakers-build/addon-herdr' }] };\n`,
    });
    const before = readFileSync(join(dir, 'conductor.config.js'), 'utf8');
    const res = runAddonRenameMigration({ bakersDirs: [dir] });
    expect(res.changed).toBe(false);
    expect(readFileSync(join(dir, 'conductor.config.js'), 'utf8')).toBe(before);
    expect(
      existsSync(join(dir, `conductor.config.js${ADDON_RENAME_BAK_SUFFIX}`)),
    ).toBe(false);
  });

  it('--dry-run prints the diff and writes NOTHING (no rewrite, no backup)', () => {
    const dir = seedLegacy(cwd);
    const res = runAddonRenameMigration({ bakersDirs: [dir], dryRun: true });
    expect(res.changed).toBe(true);
    expect(res.actions.some((a) => a.startsWith('would rewrite'))).toBe(true);
    // the diff carries the `- old` / `+ new` specifier lines
    expect(
      res.actions.some(
        (a) => a.startsWith('  - ') && a.includes('plugin-herdr'),
      ),
    ).toBe(true);
    expect(
      res.actions.some(
        (a) => a.startsWith('  + ') && a.includes('addon-herdr'),
      ),
    ).toBe(true);
    // nothing written
    expect(readFileSync(join(dir, 'conductor.config.js'), 'utf8')).toBe(
      LEGACY_ENGINE,
    );
    expect(readFileSync(join(dir, 'bakers.config.js'), 'utf8')).toBe(
      LEGACY_CONNECTION,
    );
    expect(
      existsSync(join(dir, `conductor.config.js${ADDON_RENAME_BAK_SUFFIX}`)),
    ).toBe(false);
  });

  it('a real rewrite leaves the original next to the file as a backup', () => {
    const dir = seedLegacy(cwd);
    runAddonRenameMigration({ bakersDirs: [dir] });
    const bak = join(dir, `conductor.config.js${ADDON_RENAME_BAK_SUFFIX}`);
    expect(existsSync(bak)).toBe(true);
    expect(readFileSync(bak, 'utf8')).toBe(LEGACY_ENGINE);
  });

  it('rename preview does not rewrite the legacy configs either', () => {
    const dir = seedLegacy(cwd);
    const report = runAddonRenameMigration({ bakersDirs: [dir], dryRun: true });
    expect(readFileSync(join(dir, 'conductor.config.js'), 'utf8')).toBe(
      LEGACY_ENGINE,
    );
    expect(report.actions.some((a) => a.startsWith('would rewrite'))).toBe(
      true,
    );
  });

  // BB-230 (RED, root cause 1) at the FILE level: the `@bakers-build/bakers/plugins`
  // barrel must be migrated wherever the pass already reaches — project + home
  // `.bakers/`, the default engine config AND every `<variant>.conductor.config.js`,
  // and the connection `bakers.config.js` — with the usual backup + idempotency.
  describe('@bakers-build/bakers/plugins across the covered files (BB-230)', () => {
    const BARREL_ENGINE = `export default {
  project: 'p',
  machine_id: 'm',
  remote: { plugin: '@bakers-build/bakers/plugins', export: 'drupalRemote' },
  workspace: { plugin: '@bakers-build/bakers/plugins', export: 'gitWorkspace' },
};
`;
    const BARREL_CONNECTION = `export default {
  site: { base_url: 'https://x.test' },
  plugins: [{ plugin: '@bakers-build/bakers/plugins', export: 'basicAuthProvider' }],
};
`;

    it('AC-4: rewrites the default engine config, every variant, and the connection config', () => {
      const dir = seedLegacy(cwd, {
        'conductor.config.js': BARREL_ENGINE,
        'shop.conductor.config.js': BARREL_ENGINE,
        'bakers.config.js': BARREL_CONNECTION,
      });
      const res = runAddonRenameMigration({ bakersDirs: [dir] });
      expect(res.changed).toBe(true);
      for (const f of [
        'conductor.config.js',
        'shop.conductor.config.js',
        'bakers.config.js',
      ]) {
        const out = readFileSync(join(dir, f), 'utf8');
        expect(out).not.toContain('@bakers-build/bakers/plugins');
      }
      expect(readFileSync(join(dir, 'conductor.config.js'), 'utf8')).toContain(
        `remote: { plugin: '@bakers-build/addon-remote-drupal' },`,
      );
      expect(readFileSync(join(dir, 'bakers.config.js'), 'utf8')).toContain(
        `{ plugin: '@bakers-build/addon-auth-basic' }`,
      );
    });

    it('AC-4: rename service covers the HOME `.bakers/` configs too', () => {
      const homeDir = seedLegacy(home, {
        'conductor.config.js': BARREL_ENGINE,
      });
      seedLegacy(cwd, { 'conductor.config.js': BARREL_ENGINE });
      runAddonRenameMigration({ bakersDirs: [join(cwd, '.bakers'), homeDir] });
      expect(
        readFileSync(join(homeDir, 'conductor.config.js'), 'utf8'),
      ).not.toContain('@bakers-build/bakers/plugins');
    });

    it('AC-5: a real rewrite leaves a .bak; a second run is byte-identical', () => {
      const dir = seedLegacy(cwd, { 'conductor.config.js': BARREL_ENGINE });
      runAddonRenameMigration({ bakersDirs: [dir] });
      const bak = join(dir, `conductor.config.js${ADDON_RENAME_BAK_SUFFIX}`);
      expect(existsSync(bak)).toBe(true);
      expect(readFileSync(bak, 'utf8')).toBe(BARREL_ENGINE);

      const after = readFileSync(join(dir, 'conductor.config.js'), 'utf8');
      const second = runAddonRenameMigration({ bakersDirs: [dir] });
      expect(second.changed).toBe(false);
      expect(readFileSync(join(dir, 'conductor.config.js'), 'utf8')).toBe(
        after,
      );
    });
  });
});
