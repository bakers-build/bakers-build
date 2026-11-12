// Executable acceptance test for the published bakers.build package SET. The set is NOT
// restated here: it is derived from `TARGETS` in `prepare-publish.mjs`, the
// single list that staging and `release.mjs` publishing already share. A package
// added there is packed, installed and asserted on by this gate too — there is
// no second list to keep in sync. (BB-373: there WAS one, and it omitted
// `@bakers-build/addon-bakers-ui-artifacts`, so this gate installed a `host` manifest
// whose last dependency was in neither the tarball set nor — pre-publish — the
// registry. The break was invisible until a semver tag ran `publish:npm`.)
//
// Members worth knowing about while reading the assertions below: the BB-129
// `addon-essentials` aggregator, whose own
// `@dropsh/plugin-{markdown,jsonapi-schema}` children come transitively from the
// registry; `addon-herdr`, into which BB-139 merged the former
// plugin-herdr-workspace (the workspace slot names the merged package via
// `export: 'herdrWorkspace'`); the BB-224 (Finding 6) impl addons
// `addon-{remote-drupal,workspace-git,auth-basic}` that replaced the deleted
// `@bakers-build/core/builtins` preset and `@bakers-build/core/plugins` barrel, and
// (Finding 7) the command addon `addon-deployment` extracted from the `conductor`
// command plugin — the FOURTH command surface; and the BB-220 pi agent addon
// `addon-pi` (a real transcript footprint, unlike the kimi/opencode stubs).
// It builds the real publish artifacts, packs every member into a tarball,
// installs the WHOLE SET into a throwaway project with plain `npm install` (no
// pnpm, no tsc, no workspace) — all tarballs in ONE install command, so npm resolves the
// inter-package deps (`bakers → conductor → core`, conductor-surface addons peer
// `conductor` + `core`) against the local tarballs instead of hitting the
// registry for versions that (pre-publish) don't exist there yet. Then it
// asserts:
//   1. every published manifest ships NO scripts (no end-user build step);
//   2. the `bakers` bin is on PATH and `bakers --help` prints usage;
//   3. a real descriptor `project.config.js` (no `import`, real package
//      names, no `export:` on single-factory slots) resolves its remote,
//      executor and workspace slots via `loadConductorConfig` (from
//      `@bakers-build/conductor`), and the agent from an isolated
//      `machine.config.js` `addons[]`;
//   4. the drupal remote resolves from `@bakers-build/addon-remote-drupal` in the
//      addons[] form (BB-224 — replaces the old `@bakers-build/core/builtins`
//      auto-wire assertion);
//   5. the `@bakers-build/bakers/plugins` back-compat barrel still resolves (it now
//      re-exports from the impl addons, not from core);
//   6. BB-326: `bakers ui --print-config` runs on plain Node, and the `bun`
//      runtime + `@opentui/core` the cockpit needs resolve from the INSTALLED
//      `@bakers-build/addon-bakers-ui` at the version it pins — the pnpm workspace
//      hoists both, so only an npm install proves the dependency really rides
//      along with the addon;
//   7. BB-582: no React package resolves from the installed
//      `@bakers-build/addon-bakers-ui`, and its normal entry plus both optional demo
//      entries import under the addon's own Bun;
//   8. every installed package keeps its declared license, LICENSE and NOTICE
//      (docs/bakers/licensing.md).
//
// Run: `pnpm run verify:package` (from bakers-cli/). Exits non-zero on any
// failure. Requires `dist/src` built for every package (`pnpm -r run build`);
// it runs `prepare-publish.mjs` itself, at the dev version, so a bare
// `node scripts/verify-package.mjs` after a build is enough.
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// The publish set's single source of truth. Importing it is side-effect free:
// `prepare-publish.mjs` only stages when it is the entry module.
import { TARGETS } from './prepare-publish.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..'); // bakers-cli/
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', stdio: 'pipe', ...opts });

function ok(msg) {
  console.log(`  ✓ ${msg}`);
}
function fail(msg) {
  console.error(`  ✗ ${msg}`);
  process.exit(1);
}

// The published packages, in the dep-direction order `TARGETS` declares (core
// first, the `bakers` meta last). Both the staging dirs this gate packs and the
// package names it asserts on after the install are derived from that one list,
// and the names are read off each package's own manifest — so nothing about the
// set is written down twice. Exported so a unit test can check the derivation on
// every pipeline (`core/tests/packaging/bb-373-publish-set.test.ts`), because
// this gate itself only runs on a semver tag.
const TARGET_DIRS = TARGETS.map(({ dir }) => resolve(root, dir));
export const PUBLISH_DIRS = TARGET_DIRS.map((dir) => resolve(dir, 'publish'));
export const PUBLISH_PACKAGE_NAMES = TARGET_DIRS.map(
  (dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name,
);

function main() {
  console.log(
    `verify:package — staging publish artifacts (${PUBLISH_DIRS.length} packages)`,
  );
  run('node', ['scripts/prepare-publish.mjs'], { cwd: root, stdio: 'inherit' });

  for (const dir of PUBLISH_DIRS) {
    const manifest = JSON.parse(
      readFileSync(join(dir, 'package.json'), 'utf8'),
    );
    if (manifest.scripts)
      fail(`published manifest ${manifest.name} ships scripts`);
  }
  ok('every published manifest ships no scripts (no end-user build step)');

  console.log(`verify:package — npm pack (${PUBLISH_DIRS.length} packages)`);
  const tarballs = [];
  for (const dir of PUBLISH_DIRS) {
    run('npm', ['pack'], { cwd: dir });
    const tgz = readdirSync(dir).find((f) => f.endsWith('.tgz'));
    if (!tgz) fail(`npm pack produced no tarball in ${dir}`);
    tarballs.push(join(dir, tgz));
    ok(`packed ${tgz}`);
  }

  const work = mkdtempSync(join(tmpdir(), 'bakers-verify-'));
  try {
    mkdirSync(join(work, 'proj'));
    const proj = join(work, 'proj');
    writeFileSync(
      join(proj, 'package.json'),
      JSON.stringify(
        { name: 'consumer', private: true, type: 'module' },
        null,
        2,
      ),
    );

    // Install the ENTIRE set in ONE npm install call. The versions are not on the
    // registry yet (pre-publish); listing every tarball as an explicit install
    // target lets npm satisfy the inter-package dependency ranges (`bakers →
    // conductor → core`, plugins peer `core`) from the local tarballs instead of
    // querying the registry.
    console.log(
      `verify:package — npm install (all ${tarballs.length} tarballs together, no pnpm/workspace)`,
    );
    run('npm', ['install', '--no-audit', '--no-fund', ...tarballs], {
      cwd: proj,
      stdio: 'inherit',
    });

    for (const name of PUBLISH_PACKAGE_NAMES) {
      try {
        readFileSync(
          resolve(proj, 'node_modules', ...name.split('/'), 'package.json'),
          'utf8',
        );
      } catch {
        fail(`${name} did not install from the local tarball`);
      }
    }
    ok(
      `all ${tarballs.length} tarballs installed together (no registry lookups needed)`,
    );

    // Legal files must survive pack + install: the declared license, its text and
    // any NOTICE, exactly as the source package (or the shared root LICENSE) has them.
    TARGET_DIRS.forEach((src, i) => {
      const installed = resolve(
        proj,
        'node_modules',
        ...PUBLISH_PACKAGE_NAMES[i].split('/'),
      );
      const read = (p) => {
        try {
          return readFileSync(p, 'utf8');
        } catch {
          return undefined;
        }
      };
      const name = PUBLISH_PACKAGE_NAMES[i];
      const declared = JSON.parse(read(join(src, 'package.json'))).license;
      if (
        JSON.parse(read(join(installed, 'package.json'))).license !== declared
      )
        fail(`${name} installed with a license other than ${declared}`);
      const license = read(join(src, 'LICENSE')) ?? read(join(root, 'LICENSE'));
      if (read(join(installed, 'LICENSE')) !== license)
        fail(`${name} installed without its LICENSE text`);
      if (read(join(installed, 'NOTICE')) !== read(join(src, 'NOTICE')))
        fail(`${name} installed without its NOTICE`);
    });
    ok(
      'every installed package carries its declared license, LICENSE and NOTICE',
    );

    // The installed @bakers-build/addon-claude must ship the measure wrapper ClaudeAgent
    // resolves when measure: true, and that wrapper must write the state-group
    // settings. A files glob that matched nothing at pack time used to leave the
    // wrapper off the tarball with no npm error.
    {
      writeFileSync(
        join(proj, 'check-claude-measure.mjs'),
        `import { existsSync } from 'node:fs';
import { ClaudeAgent } from '@bakers-build/addon-claude';
const cmd = new ClaudeAgent({ measure: true }).launchCommand('go');
const m = cmd.match(/^(?:\\w+=\\S+ )*node '([^']+)' /);
if (!m) {
  console.error('measure launch did not wrap in node: ' + cmd);
  process.exit(1);
}
if (!existsSync(m[1])) {
  console.error('measure wrapper missing: ' + m[1]);
  process.exit(1);
}
console.log(m[1]);
`,
      );
      const wrapper = run('node', ['check-claude-measure.mjs'], {
        cwd: proj,
      }).trim();
      const measureCwd = join(work, 'claude-measure-run');
      mkdirSync(measureCwd);
      run('git', ['init', '-q'], { cwd: measureCwd });
      writeFileSync(
        join(measureCwd, '.gitignore'),
        '/.bakers/claude-measure.settings.json\n/assets-ai/\n',
      );
      run(process.execPath, [wrapper, 'true'], {
        cwd: measureCwd,
        env: {
          ...process.env,
          BAKERS_STATE: 'diagnose',
          BAKERS_TICKET_IDENTIFIER: 'VERIFY-1',
        },
      });
      try {
        JSON.parse(
          readFileSync(
            join(measureCwd, '.bakers', 'claude-measure.settings.json'),
            'utf8',
          ),
        );
      } catch {
        fail(
          'installed measure wrapper did not write .bakers/claude-measure.settings.json',
        );
      }
      ok(
        'installed @bakers-build/addon-claude measure wrapper exists and writes settings',
      );
    }

    // BB-608: the OAuth2 plugin adopts a session another process renewed only
    // through dropsh core's `AdapterRuntime.load`, and `instanceof HttpError`
    // checks cross the core/plugin boundary. Two physical copies of either
    // package would split both, so every installed bakers.build package that declares
    // `dropsh` or `@dropsh/plugin-oauth2` must resolve the same package root, and
    // no second copy may sit anywhere under node_modules.
    writeFileSync(
      join(proj, 'check-dropsh.mjs'),
      `import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
  import { createRequire } from 'node:module';
  import { dirname, join } from 'node:path';
  import { pathToFileURL } from 'node:url';
  const wanted = ['dropsh', '@dropsh/plugin-oauth2'];
  const bakers = ${JSON.stringify(PUBLISH_PACKAGE_NAMES)};
  const nm = join(process.cwd(), 'node_modules');
  const manifest = (dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const roots = Object.fromEntries(wanted.map((name) => [name, new Set()]));
  const versions = Object.fromEntries(wanted.map((name) => [name, new Set()]));
  const add = (name, dir) => {
    const real = realpathSync(dir);
    roots[name].add(real);
    versions[name].add(manifest(real).version);
  };
  function packageRoot(file, name) {
    for (let dir = dirname(file); dir !== dirname(dir); dir = dirname(dir))
      if (existsSync(join(dir, 'package.json')) && manifest(dir).name === name) return dir;
    throw new Error('no package root for ' + name + ' above ' + file);
  }
  const declaring = {};
  for (const pkg of bakers) {
    const dir = join(nm, ...pkg.split('/'));
    const m = manifest(dir);
    const deps = { ...m.dependencies, ...m.peerDependencies, ...m.optionalDependencies };
    for (const name of wanted) {
      if (!deps[name]) continue;
      (declaring[name] ??= []).push(pkg);
      add(name, packageRoot(createRequire(join(dir, 'package.json')).resolve(name), name));
    }
  }
  (function walk(modules) {
    if (!existsSync(modules)) return;
    for (const entry of readdirSync(modules, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === '.bin') continue;
      const dirs = entry.name.startsWith('@')
        ? readdirSync(join(modules, entry.name), { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .map((e) => [entry.name + '/' + e.name, join(modules, entry.name, e.name)])
        : [[entry.name, join(modules, entry.name)]];
      for (const [name, dir] of dirs) {
        if (wanted.includes(name)) add(name, dir);
        walk(join(dir, 'node_modules'));
      }
    }
  })(nm);
  const errorFrom = async (pkg) => {
    const fromPkg = createRequire(join(nm, ...pkg.split('/'), 'package.json'));
    return (await import(pathToFileURL(fromPkg.resolve('dropsh/plugin')).href)).HttpError;
  };
  const addon = declaring.dropsh.find((pkg) => pkg !== '@bakers-build/core');
  const coreHttpError = await errorFrom('@bakers-build/core');
  console.log(JSON.stringify({
    declaring,
    roots: Object.fromEntries(wanted.map((n) => [n, [...roots[n]]])),
    versions: Object.fromEntries(wanted.map((n) => [n, [...versions[n]]])),
    addon,
    httpErrorShared: typeof coreHttpError === 'function' && coreHttpError === (await errorFrom(addon)),
  }));
`,
    );
    const dropshReport = JSON.parse(
      run('node', ['check-dropsh.mjs'], { cwd: proj }),
    );
    for (const name of ['dropsh', '@dropsh/plugin-oauth2']) {
      if (dropshReport.roots[name].length !== 1)
        fail('Installed CLI contains duplicate dropsh or OAuth2 package roots');
      ok(
        `${name}@${dropshReport.versions[name].join(',')} resolves to one root from ${dropshReport.declaring[name].length} declaring packages: ${dropshReport.roots[name][0]}`,
      );
    }
    if (!dropshReport.httpErrorShared)
      fail(
        `dropsh HttpError differs between @bakers-build/core and ${dropshReport.addon}`,
      );
    ok(
      `dropsh HttpError is the same constructor from @bakers-build/core and ${dropshReport.addon}`,
    );

    // BB-205: the packaged/published artifact must ship the skill-neutral
    // dispatch prompt. The bug was a stale compiled `dist/src/config.js` bundled
    // into `@bakers-build/bakers` (via `@bakers-build/conductor`) that still carried the
    // obsolete monolithic-dispatch prompt. This asserts the tarball actually
    // installed here — the artifact a global `npm i -g @bakers-build/bakers` would run —
    // carries no obsolete text and renders the neutral WORKFLOW.md contract.
    {
      const promptFile = resolve(
        proj,
        'node_modules',
        '@bakers-build',
        'conductor',
        'dist',
        'src',
        'config.js',
      );
      const promptSrc = readFileSync(promptFile, 'utf8');
      const m = promptSrc.match(/DEFAULT_AGENT_PROMPT\s*=\s*([\s\S]*?);/);
      const prompt = m
        ? m[1].replace(/`/g, '').replace(/\+/g, ' ').replace(/\s+/g, ' ').trim()
        : '';
      for (const bad of [
        'Invoke the bakers skill',
        'ticket:run',
        'coding engine',
        'bakers tools',
        // BB-204 made WORKFLOW.md a pure loader, so no project carries a
        // `State: <state>` section for the prompt to point at. A packaged
        // prompt that still names one stops literal-minded agents mid-dispatch.
        'State: {state}',
        // The run reads through bakers_ticket_read like every skill step.
        'dropsh --format md read',
        // The run's CLI call names the bare tool; the server prefix is gone.
        'tool_api__',
        // The default read returns the newest comments, not all of them.
        'and all comments',
      ]) {
        if (prompt.includes(bad)) {
          fail(
            `packaged @bakers-build/conductor DEFAULT_AGENT_PROMPT contains "${bad}"`,
          );
        }
      }
      for (const marker of [
        'Read the ticket with the bakers tool bakers_ticket_read',
        'bakers_ticket_read',
        'Follow the loaded skill for tool discovery, transport and fallback',
        './WORKFLOW.md',
        "that skill's {state} section",
        'Do not start or prepare a later state',
      ]) {
        if (!prompt.includes(marker)) {
          fail(
            `packaged @bakers-build/conductor DEFAULT_AGENT_PROMPT missing "${marker}"`,
          );
        }
      }
      ok(
        'packaged @bakers-build/conductor ships the skill-neutral dispatch prompt',
      );
    }

    // 1. bin on PATH + --help
    const bin = join(proj, 'node_modules', '.bin', 'bakers');
    const help = run(bin, ['--help']);
    if (!/bakers.build conductor/.test(help))
      fail('`bakers --help` did not print usage');
    ok('`bakers --help` prints usage from the installed meta-package bin');

    // Public commands remain discoverable without loading their runtimes.
    for (const cmd of ['conductor', 'ui', 'tools', 'auth', 'deployment']) {
      if (!new RegExp(`\\b${cmd}\\b`).test(help)) {
        fail(`\`bakers --help\` did not list the '${cmd}' command`);
      }
    }
    if (/\boven\b/.test(help))
      fail('Hidden oven alias leaked into top-level help');
    if (/\bdropsh\b/.test(help))
      fail('Compatibility command leaked into top-level help');
    for (const [command, expected] of [
      ['tools', '--schema'],
      ['auth', 'login'],
    ]) {
      const aliasHelp = run(bin, [command, '--help']);
      if (
        !aliasHelp.includes(`bakers ${command}`) ||
        !aliasHelp.includes(expected) ||
        /\bdropsh\b/.test(aliasHelp)
      ) {
        fail(
          `Installed ${command} alias did not expose its own help: ${aliasHelp}`,
        );
      }
    }
    if (!run(bin, ['dropsh', '--help']).includes('JSON:API')) {
      fail('Hidden compatibility command no longer dispatches');
    }
    ok(
      'public tools/auth help and hidden compatibility dispatch work in the installed package',
    );

    // 1c. the deployment command really MOUNTS from its own package (not from the
    //     conductor command plugin): its subcommand help must render.
    const depHelp = run(bin, ['deployment', 'tickets', '--help']);
    if (!/--since <ref>/.test(depHelp) || !/--to <ref>/.test(depHelp)) {
      fail(
        '`bakers deployment tickets --help` did not mount from @bakers-build/addon-deployment',
      );
    }
    ok(
      '`bakers deployment tickets` mounts from @bakers-build/addon-deployment',
    );

    // Configuration help/dispatch remains available on an unbootable checkout.
    const broken = join(proj, 'broken');
    mkdirSync(join(broken, '.bakers'), { recursive: true });
    const brokenConfig = join(broken, '.bakers/connection.config.js');
    const brokenMachine = join(broken, 'machine.config.js');
    const source =
      "throw new Error('configuration must never import'); export default {";
    writeFileSync(brokenConfig, source);
    writeFileSync(brokenMachine, source);
    const offlineEnv = {
      ...process.env,
      BAKERS_CONFIG: brokenConfig,
      BAKERS_CONDUCTOR_LOG: 'stdout',
      BAKERS_LOG_LEVEL: 'silent',
    };
    for (const args of [
      ['config', '--help'],
      ...['init', 'upgrade', 'check'].map((command) => [
        'config',
        command,
        '--help',
      ]),
    ]) {
      const output = run(bin, args, { cwd: broken, env: offlineEnv });
      if (!/init|upgrade|check|--scope/.test(output))
        fail('canonical configuration help missing');
    }
    // `bakers init` is not in this list: it returned as the shortcut for
    // `bakers config init` (device-code sign-in), so it must not be rejected.
    for (const args of [
      ['upgrade'],
      ['conductor', 'init'],
      ['bake'],
      ['oven', 'init'],
    ]) {
      let rejected = false;
      try {
        run(bin, args, { cwd: broken, env: offlineEnv });
      } catch (error) {
        rejected =
          error.status !== 0 && /unknown command/i.test(String(error.stderr));
      }
      if (!rejected)
        fail(
          'removed entry point did not return unknown command: ' +
            args.join(' '),
        );
    }
    for (const command of ['check', 'upgrade']) {
      const args = [
        'config',
        command,
        '--scope',
        'all',
        '--format',
        'json',
        '--machine-path',
        brokenMachine,
        '--config',
        brokenConfig,
      ];
      if (command === 'upgrade') args.push('--dry-run');
      let output;
      try {
        output = run(bin, args, { cwd: broken, env: offlineEnv });
      } catch (error) {
        if (error.status !== 1) throw error;
        output = String(error.stdout);
      }
      const report = JSON.parse(output);
      if (
        report.result !== 'blocked' ||
        !report.findings.some((f) => f.code === 'syntax_error')
      )
        fail('offline broken-source diagnostics missing');
    }
    if (
      readFileSync(brokenConfig, 'utf8') !== source ||
      readFileSync(brokenMachine, 'utf8') !== source ||
      readdirSync(join(broken, '.bakers')).length !== 1 ||
      readdirSync(broken).length !== 2
    )
      fail('help, rejected commands or offline diagnostics changed files');
    ok(
      'canonical config help, removed-command rejection and offline check/upgrade preserve broken files',
    );

    // 2. BB-201 split config: the ENGINE project.config.js resolves all 4
    //    slots via loadConductorConfig (no site/plugins), and the CONNECTION
    //    connection.config.js resolves site + plugins[] via loadBbConfig (never the
    //    engine). BB-224: the remote slot names the real addon package
    //    `@bakers-build/addon-remote-drupal` (default-exports its factory), so the only
    //    surviving `export:` is the merged herdr workspace (herdrWorkspace);
    //    remote/executor/agent all auto-pick.
    mkdirSync(join(proj, '.bakers'), { recursive: true });
    writeFileSync(
      join(proj, '.bakers', 'project.config.js'),
      `// @bakers-schema-version 1
  export default {
    schema_version: 1,
    project: { name: 'demo' },
    states: ['coding'],
    server: { use: '@bakers-build/addon-remote-drupal' },
    executor: { use: '@bakers-build/addon-herdr' },
    worktree: { use: '@bakers-build/addon-herdr', export: 'herdrWorkspace' },
  };
  `,
    );
    // Generate through the installed public planner: no machine file is needed.
    writeFileSync(
      join(proj, 'generate.mjs'),
      `
      import { planConfig, applyConfigPlan } from '@bakers-build/conductor/config';
      const plan = planConfig({ scope: 'connection', home: ${JSON.stringify(join(work, 'isolated-home'))}, cwd: process.cwd(),
        connectionPath: ${JSON.stringify(join(proj, '.bakers/connection.config.js'))},
        inputs: { baseUrl: 'https://x.test', clientId: 'bakers-agent', secret: 'fixture-secret', workspaceId: '9f1d4e4e-0000-4000-8000-abcdefabcdef' } });
      if (applyConfigPlan(plan).result !== 'ok') throw new Error(JSON.stringify(plan.report));
      const generated = (await import(${JSON.stringify(pathToFileURL(join(proj, '.bakers/connection.config.js')).href)})).default;
      const providers = generated.plugins.filter(entry => entry.plugin === '@dropsh/plugin-oauth2');
      if (providers.length !== 1 || providers[0].with.id !== 'bakers' || providers[0].with.scope !== 'bb:session' || providers[0].with.client_secret !== 'fixture-secret') throw new Error('generated connection did not preserve one configured identity');
    `,
    );
    run('node', ['generate.mjs'], { cwd: proj });
    // Agents are a per-machine concern since the machine agent policy moved
    // into `machine.config.js` (`addons[]`; agent harnesses declare the machine
    // scope); a conductor config that still names one does not load it. The installed set must resolve the Grok agent from
    // there, so the checks below run against an isolated machine context.
    const machineHome = join(work, 'isolated-home', '.bakers');
    mkdirSync(machineHome, { recursive: true });
    writeFileSync(
      join(machineHome, 'machine.config.js'),
      `// @bakers-schema-version 1
  export default {
    schema_version: 1,
    machine_id: '9f1d4e4e-0000-4000-8000-000000000001',
    label: 'verify-package',
    addons: [{ use: '@bakers-build/addon-grok', with: { model: 'grok-4.5' } }],
  };
  `,
    );
    // BB-215 addon form: a SECOND config pair that names ONLY packages in
    // `addons: []` (no export:/kind) — the conductor addons[] must auto-wire the
    // remote, executor and workspace slots (herdr once → executor + workspace;
    // the agent comes from the machine context) and the connection addons[]
    // must resolve site + the auth/renderer plugins. Proves AC-2 in the published
    // package set, alongside the per-slot/plugins[] back-compat configs above.
    mkdirSync(join(proj, '.bakers-addons'), { recursive: true });
    writeFileSync(
      join(proj, '.bakers-addons', 'project.config.js'),
      `// @bakers-schema-version 1
  export default {
    schema_version: 1,
    project: { name: 'demo-addons' },
    states: ['coding'],
    addons: [
      '@bakers-build/addon-remote-drupal',
      '@bakers-build/addon-herdr',
    ],
  };
  `,
    );
    writeFileSync(
      join(proj, '.bakers-addons', 'connection.config.js'),
      `// @bakers-schema-version 1
  export default {
    schema_version: 1,
    site: { base_url: 'https://x.test' },
    workspace_id: '9f1d4e4e-0000-4000-8000-abcdefabcdef',
    addons: [
      { use: '@dropsh/plugin-oauth2', with: {
        id: 'bakers', default: true, type: 'oauth2_client_credentials',
        client_id: 'bakers-agent', token_url: 'https://x.test/oauth/token',
        scope: 'bb:session',
      } },
      '@bakers-build/addon-essentials',
    ],
  };
  `,
    );
    writeFileSync(
      join(proj, 'check.mjs'),
      `import { createRequire } from 'node:module';
  import { loadBbConfig } from '@bakers-build/core';
  import { loadConductorConfig } from '@bakers-build/conductor';
  // ENGINE half: the four slots resolve; site/plugins are NOT part of it (BB-201).
  const eng = await loadConductorConfig('./.bakers/project.config.js');
  if (eng.remote?.kind !== 'server') { console.error('remote plugin did not resolve'); process.exit(1); }
  if (eng.executor?.kind !== 'executor') { console.error('executor plugin did not resolve'); process.exit(1); }
  const resolvedAgent = eng.agents?.find((candidate) => candidate.agent?.id === 'grok');
  if (resolvedAgent?.agent?.kind !== 'agent' || eng.default_agent !== resolvedAgent.alias) { console.error('Grok agent did not resolve from machine.config.js addons[]: ' + JSON.stringify(eng.agents)); process.exit(1); }
  if (eng.workspace?.kind !== 'worktree') { console.error('workspace plugin did not resolve'); process.exit(1); }
  if (eng.site !== undefined || eng.plugins !== undefined) { console.error('engine config leaked site/plugins'); process.exit(1); }
  // CONNECTION half: site + plugins[] resolve via loadBbConfig (lenient, no engine).
  const host = { resolveBases: [import.meta.url] };
  const conn = await loadBbConfig(host, { cwd: process.cwd() });
  if (conn.site?.base_url !== 'https://x.test') { console.error('connection site did not resolve'); process.exit(1); }
  const pluginIds = conn.plugins.map((p) => p?.id);
  if (conn.plugins.length !== 4 || !pluginIds.includes('markdown') || !pluginIds.includes('jsonapi-schema')) {
    console.error('connection plugins[] did not flatten essentials into its children: ' + JSON.stringify(pluginIds)); process.exit(1);
  }
  // BB-403: addon-name-refs must arrive as a CHILD
  // of essentials — no committed config names '@bakers-build/addon-name-refs'. It was
  // missing from the publish set entirely (essentials shipped a dependency on an
  // unpublished package), so this presence check is exactly what would have
  // caught the broken 0.11.0 before it reached the registry.
  if (!pluginIds.includes('bakers-name-refs')) {
    console.error('addon-name-refs did not arrive through addon-essentials: ' + JSON.stringify(pluginIds)); process.exit(1);
  }
  // BB-495: the dropsh request path carries authentication and nothing
  // else, so essentials no longer attaches the ambient-workspace filler (bakers
  // ui adds it to its own chain). A filler arriving here again would fill a
  // workspace into every connection's writes behind the caller's back.
  if (pluginIds.includes('bakers-workspace')) {
    console.error('addon-essentials attached the workspace filler again: ' + JSON.stringify(pluginIds)); process.exit(1);
  }
  // BB-226 (AC-1): the RESOLVED project connection exposes the 'md' renderer —
  // this is what makes \`bakers dropsh --format md read …\` work instead of failing
  // with "E_CONFIG: Unknown format 'md'. Available: json".
  const connRenderers = conn.plugins.flatMap((p) => p?.renderers ?? []).map((r) => r?.id);
  if (!connRenderers.includes('md')) {
    console.error('resolved project connection exposes no md renderer: ' + JSON.stringify(connRenderers)); process.exit(1);
  }
  // The essentials aggregator installs transitively + exposes the 'md' renderer.
  const bakersEssentials = (await import('@bakers-build/addon-essentials')).default;
  const essentials = bakersEssentials();
  if (!essentials.flatMap((p) => p.renderers ?? []).some((r) => r.id === 'md')) {
    console.error('addon-essentials aggregator did not expose the md renderer'); process.exit(1);
  }
  // Back-compat: the @bakers-build/bakers/plugins barrel must still resolve + export the
  // built-in contributions — BB-224 re-pointed it at the impl addons
  // (@bakers-build/addon-remote-drupal + @bakers-build/addon-auth-basic) since
  // @bakers-build/core/plugins is deleted.
  const require = createRequire(import.meta.url);
  require.resolve('@bakers-build/bakers/plugins');
  const barrel = await import('@bakers-build/bakers/plugins');
  if (typeof barrel.drupalRemote !== 'function' || typeof barrel.basicAuthProvider !== 'function') {
    console.error('@bakers-build/bakers/plugins barrel missing built-ins'); process.exit(1);
  }
  // BB-224: the drupal remote must resolve from its own addon package, and the
  // deleted core subpaths must be gone from the PUBLISHED artifacts.
  const drupalAddon = await import('@bakers-build/addon-remote-drupal');
  if (typeof drupalAddon.drupalRemote !== 'function' || drupalAddon.default !== drupalAddon.drupalRemote) {
    console.error('@bakers-build/addon-remote-drupal does not default-export drupalRemote'); process.exit(1);
  }
  if (drupalAddon.drupalRemote().id !== 'drupal') {
    console.error('@bakers-build/addon-remote-drupal did not build the drupal remote'); process.exit(1);
  }
  for (const gone of ['@bakers-build/core/plugins', '@bakers-build/core/builtins']) {
    let resolved = false;
    try { require.resolve(gone); resolved = true; } catch {}
    if (resolved) { console.error(gone + ' must no longer be exported by @bakers-build/core (BB-224)'); process.exit(1); }
  }
  // BB-215 addon form: the addons:[] configs auto-wire every slot with NO
  // export:/kind wiring. Conductor: builtins → drupal remote, herdr (one entry) →
  // executor + workspace; the agent comes from the machine context. Connection: the one 'bakers' oauth2
  // provider (BB-391) + essentials. NOTE: this text lives INSIDE the check.mjs
  // template literal, so it must never use a backtick.
  const engB = await loadConductorConfig('./.bakers-addons/project.config.js');
  if (engB.remote?.id !== 'drupal') { console.error('addon remote (@bakers-build/addon-remote-drupal) did not auto-wire: ' + JSON.stringify(engB.remote?.id)); process.exit(1); }
  if (engB.executor?.id !== 'herdr') { console.error('addon executor (herdr) did not auto-wire'); process.exit(1); }
  if (engB.workspace?.id !== 'herdr') { console.error('addon workspace (herdr, same entry) did not auto-wire'); process.exit(1); }
  const addonAgent = engB.agents?.find((candidate) => candidate.agent?.id === 'grok')?.agent;
  if (addonAgent?.kind !== 'agent') { console.error('machine agent (grok) did not resolve beside the addon-form config: ' + JSON.stringify(engB.agents)); process.exit(1); }
  const connB = await loadBbConfig(host, { explicit: process.cwd() + '/.bakers-addons/connection.config.js' });
  if (connB.site?.base_url !== 'https://x.test') { console.error('addon connection site did not resolve'); process.exit(1); }
  const idsB = connB.plugins.map((p) => p?.id);
  if (!idsB.includes('markdown') || !idsB.includes('jsonapi-schema')) {
    console.error('addon connection essentials did not resolve: ' + JSON.stringify(idsB)); process.exit(1);
  }
  if (!connB.plugins.some((p) => p?.authProvider || p?.id === 'bakers')) {
    console.error("addon connection oauth2 provider 'bakers' did not resolve: " + JSON.stringify(idsB)); process.exit(1);
  }
  if (idsB.includes('bakers-workspace')) {
    console.error('addon connection carried the workspace filler through essentials: ' + JSON.stringify(idsB)); process.exit(1);
  }
  if (!connB.plugins.flatMap((p) => p?.renderers ?? []).some((r) => r?.id === 'md')) {
    console.error('addon connection exposes no md renderer'); process.exit(1);
  }
  console.log('engine config resolved remote/executor/grok agent/workspace; connection resolved site/plugins; md renderer OK; bakers/plugins barrel OK; drupal remote resolves from @bakers-build/addon-remote-drupal; core/plugins + core/builtins gone; addon-form configs auto-wired all slots');
  `,
    );
    const out = run('node', ['check.mjs'], {
      cwd: proj,
      env: { ...process.env, BAKERS_HOME: machineHome },
    });
    if (!/engine config resolved/.test(out)) {
      fail('split-config resolution check failed');
    }
    if (!/addon-form configs auto-wired/.test(out)) {
      fail('addon-form config resolution check failed');
    }
    if (
      !/drupal remote resolves from @bakers-build\/addon-remote-drupal/.test(
        out,
      )
    ) {
      fail(
        'the drupal remote did not resolve from @bakers-build/addon-remote-drupal',
      );
    }
    ok(
      'split config: slots resolve from per-slot + addons[] forms and the Grok agent from machine.config.js; connection plugins resolve; @bakers-build/bakers/plugins barrel resolves; drupal remote resolves from @bakers-build/addon-remote-drupal; core/plugins + core/builtins are gone',
    );

    // 6. BB-326: the cockpit's runtime. `@bakers-build/addon-bakers-ui` reaches
    //    OpenTUI's Zig core through FFI, which Node does not expose, so it carries
    //    `bun` as an ordinary npm dependency and `bakers ui` re-execs under it. Three
    //    properties of that arrangement only exist in an INSTALLED tree and are
    //    invisible in the pnpm workspace, where `bun` is hoisted into a shared
    //    store and every package can see it by accident:
    //      a. `--print-config` still runs on plain NODE. It is what a human runs
    //         when the cockpit will not start, and a diagnostic that needs the
    //         runtime it diagnoses is worth nothing.
    //      b. `bun/package.json` resolves from the installed addon, through the
    //         same two-hop lookup `ui/src/bun-runtime.ts` performs.
    //      c. the resolved binary really is the pinned version — npm has to have RUN bun's
    //         postinstall, which is what downloads the platform binary. Without it
    //         the manifest is present, the launcher is a stub and `bakers ui` fails
    //         at the moment a user first starts it.
    // Existing logger sink keeps diagnostic startup out of the operator's home.
    const uiConfig = run(bin, ['ui', '--print-config'], {
      cwd: proj,
      env: {
        ...process.env,
        BAKERS_CONDUCTOR_LOG: 'stdout',
        BAKERS_LOG_LEVEL: 'silent',
      },
    });
    if (!/^base_url:\s+https:\/\/x\.test$/m.test(uiConfig)) {
      fail(
        `\`bakers ui --print-config\` did not resolve the project connection on Node:\n${uiConfig}`,
      );
    }
    if (
      !new RegExp(
        `^connection:\\s+${proj}/\\.bakers/connection\\.config\\.js$`,
        'm',
      ).test(uiConfig)
    ) {
      fail(
        `\`bakers ui --print-config\` did not report the project config as the winner:\n${uiConfig}`,
      );
    }
    ok(
      '`bakers ui --print-config` runs on Node from the installed package set',
    );

    // 7. BB-582: the TUI renders without React. A React runtime the addon
    //    still pulled in would only show in an INSTALLED tree (the workspace
    //    store keeps every package's dependencies visible to every other), so
    //    resolve each React package from the installed addon — none may resolve
    //    — and import the normal entry and both optional native demo entries
    //    under the addon's own Bun: an import of a React package that is not
    //    installed fails right there.
    writeFileSync(
      join(proj, 'check-react.mjs'),
      `import { execFileSync } from 'node:child_process';
  import { readFileSync } from 'node:fs';
  import { createRequire } from 'node:module';
  import { dirname, join } from 'node:path';
  const addon = createRequire(import.meta.url).resolve('@bakers-build/addon-bakers-ui');
  const fromAddon = createRequire(addon);
  for (const name of ['react', 'react-dom', 'react-reconciler', '@opentui/react']) {
    let resolved;
    try { resolved = fromAddon.resolve(name); } catch {}
    if (resolved) { console.error('resolved ' + name + ' from the installed addon: ' + resolved); process.exit(1); }
  }
  const manifest = fromAddon.resolve('bun/package.json');
  const { bin } = JSON.parse(readFileSync(manifest, 'utf8'));
  const exe = join(dirname(manifest), typeof bin === 'string' ? bin : bin?.bun);
  const entries = [
    '@bakers-build/addon-bakers-ui',
    '@bakers-build/addon-bakers-ui/react-experiment',
    '@bakers-build/addon-bakers-ui/react-experiment/preset',
  ];
  const script = 'for (const entry of ' + JSON.stringify(entries) + ') await import(entry); console.log("entries imported");';
  console.log(execFileSync(exe, ['-e', script], { encoding: 'utf8' }).trim());
  console.log('no React package resolves from the installed addon');
  `,
    );
    const reactOut = run('node', ['check-react.mjs'], { cwd: proj });
    if (
      !/^entries imported$/m.test(reactOut) ||
      !/^no React package resolves/m.test(reactOut)
    ) {
      fail(`the installed TUI is not React-free:\n${reactOut}`);
    }
    ok(
      'no React package resolves from the installed @bakers-build/addon-bakers-ui; its normal and both demo entries import under its Bun',
    );

    writeFileSync(
      join(proj, 'check-bun.mjs'),
      `import { execFileSync } from 'node:child_process';
  import { readFileSync } from 'node:fs';
  import { createRequire } from 'node:module';
  import { dirname, join } from 'node:path';
  // The same two hops \`resolveBunBinary\` makes: the renderer addon first (the one
  // dynamic edge \`@bakers-build/ui\` has), then \`bun\` from the addon's own base.
  const addon = createRequire(import.meta.url).resolve('@bakers-build/addon-bakers-ui');
  const fromAddon = createRequire(addon);
  const manifest = fromAddon.resolve('bun/package.json');
  const { bin } = JSON.parse(readFileSync(manifest, 'utf8'));
  const relative = typeof bin === 'string' ? bin : bin?.bun;
  if (!relative) { console.error('bun manifest declares no bin'); process.exit(1); }
  const exe = join(dirname(manifest), relative);
  // A missing prebuilt is a load-time error, so resolving OpenTUI here is the
  // glibc half of the platform criterion, checked without importing it (an import
  // would open the FFI library, which is Bun's job and not Node's).
  fromAddon.resolve('@opentui/core');
  console.log('bun manifest:  ' + manifest);
  console.log('bun version:   ' + execFileSync(exe, ['--version'], { encoding: 'utf8' }).trim());
  `,
    );
    const bunOut = run('node', ['check-bun.mjs'], { cwd: proj });
    // The version the addon pins, read from its manifest rather than restated
    // here, so a runtime bump cannot leave this gate asserting the old one.
    const pinnedBun = JSON.parse(
      readFileSync(join(root, 'addons/bakers-ui/package.json'), 'utf8'),
    ).dependencies.bun;
    if (!bunOut.split('\n').includes(`bun version:   ${pinnedBun}`)) {
      fail(
        `the bun resolved from the installed @bakers-build/addon-bakers-ui is not ${pinnedBun}:\n${bunOut}`,
      );
    }
    ok(
      `bun/package.json + @opentui/core resolve from the installed @bakers-build/addon-bakers-ui; bun --version is ${pinnedBun}`,
    );

    console.log('\nverify:package — OK');
  } finally {
    rmSync(work, { recursive: true, force: true });
    for (const tgz of tarballs) rmSync(tgz, { force: true });
  }
}

// Only run the gate when invoked directly (`node scripts/verify-package.mjs`).
// Importing it — the packaging unit test does, to assert the derived set — must
// not pack tarballs or reach the network.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
