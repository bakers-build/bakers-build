/**
 * claude-measure — launch wrapper for `@bakers-build/addon-claude` `with.measure`.
 *
 *   node claude-measure.mjs claude <claude args…>
 *
 * Writes the state group's settings, with an inline `--settings` JSON and the
 * project's own `enabledPlugins` on top, to `.bakers/claude-measure.settings.json`
 * — or, where git does not
 * ignore that path, to a temporary file whose path replaces the `--settings`
 * argument, so a foreign repository gains no untracked file. It then
 * starts agent-proxy on an ephemeral loopback port, runs the command with
 * `ANTHROPIC_BASE_URL` pointing at it, and closes the proxy when the command
 * exits. The proxy therefore lives exactly as long as the agent process: no
 * conductor state, nothing to reap after a restart.
 *
 * Reads `BAKERS_STATE`, `BAKERS_TICKET_IDENTIFIER` and `BAKERS_RUN_UUID` from the run
 * env; logs go to `assets-ai/<identifier>/node/<run uuid>/`, exported to the
 * command as `BB_PROXY_LOG_DIR`. When the
 * proxy cannot start (no identifier, log directory not gitignored) the command
 * still runs, unmeasured, with a warning on stderr.
 *
 *   node claude-measure.mjs --capture claude <claude args…>
 *
 * The `with.proxy` mode: only the proxy, its log directory and
 * `ANTHROPIC_BASE_URL`; argv and settings pass through unchanged and no
 * settings file is written, so the log shows what a normal run sends.
 */

import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './agent-proxy.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SETTINGS_REL = path.join('.bakers', 'claude-measure.settings.json');

const GROUPS = {
  qualification: 'plan',
  spec: 'plan',
  diagnose: 'plan',
  coding: 'coding',
  review: 'review',
};

const argv = process.argv.slice(2);
// `--capture` only logs: argv and the caller's settings stay untouched.
const capture = argv[0] === '--capture';
const [command, ...args] = capture ? argv.slice(1) : argv;
if (!command) {
  console.error('usage: node claude-measure.mjs [--capture] <command> [args…]');
  process.exit(2);
}

/** A project's own plugin choice, e.g. an opt-out of a stale plugin copy. */
function projectPlugins() {
  const merged = {};
  for (const file of ['settings.json', 'settings.local.json']) {
    try {
      Object.assign(
        merged,
        JSON.parse(fs.readFileSync(path.join('.claude', file), 'utf8'))
          .enabledPlugins,
      );
    } catch {
      /* absent or unreadable: nothing to honour */
    }
  }
  return merged;
}

/** Write the measure settings file; returns the temporary file to remove, if any. */
function writeMeasureSettings() {
  // `--settings` outranks project settings, so fold the project's enabledPlugins
  // into the copy: the profile is a default, the project has the last word.
  const group = GROUPS[process.env.BAKERS_STATE] ?? 'ops';
  let profile = JSON.parse(
    fs.readFileSync(path.join(HERE, `keytec-${group}.json`), 'utf8'),
  );
  // The last one: an alias's own `--settings` precedes the measure flags.
  const settingsAt = args.lastIndexOf('--settings');
  // A security mode's inline settings (sandbox, custom) win over the profile;
  // permission lists are joined so neither side's rules are lost.
  const inline = settingsAt === -1 ? undefined : args[settingsAt + 1];
  if (inline?.trimStart().startsWith('{')) {
    const own = JSON.parse(inline);
    const join = (key) => [
      ...(profile.permissions?.[key] ?? []),
      ...(own.permissions?.[key] ?? []),
    ];
    profile = {
      ...profile,
      ...own,
      permissions: {
        ...profile.permissions,
        ...own.permissions,
        allow: join('allow'),
        deny: join('deny'),
      },
    };
  }
  profile.enabledPlugins = { ...profile.enabledPlugins, ...projectPlugins() };
  const ignored =
    spawnSync('git', ['check-ignore', '-q', SETTINGS_REL]).status === 0;
  const settingsFile = ignored
    ? SETTINGS_REL
    : path.join(os.tmpdir(), `claude-measure-${randomUUID()}.settings.json`);
  if (settingsAt !== -1) args[settingsAt + 1] = settingsFile;
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(settingsFile, `${JSON.stringify(profile, null, 2)}\n`);
  return ignored ? undefined : settingsFile;
}
const tempSettings = capture ? undefined : writeMeasureSettings();

const env = { ...process.env };
let proxy;
try {
  // One subdirectory per run, so several runs of a ticket stay apart.
  proxy = await startServer({
    port: 0,
    cwd: process.cwd(),
    quiet: true,
    logSubdir: process.env.BAKERS_RUN_UUID || undefined,
  });
  env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${proxy.address.port}`;
  env.BB_PROXY_LOG_DIR = proxy.logDirectory;
} catch (err) {
  console.error(`${err.message} — running unmeasured`);
}

const child = spawn(command, args, { stdio: 'inherit', env });
// The terminal sends SIGINT to the whole process group; the child decides.
process.on('SIGINT', () => {});
for (const signal of ['SIGTERM', 'SIGHUP']) {
  process.on(signal, () => child.kill(signal));
}
child.on('error', (err) => {
  console.error(`claude-measure: ${err.message}`);
  if (tempSettings) fs.rmSync(tempSettings, { force: true });
  process.exit(127);
});
child.on('exit', async (code, signal) => {
  await proxy?.close();
  if (tempSettings) fs.rmSync(tempSettings, { force: true });
  process.exit(code ?? (signal ? 128 + os.constants.signals[signal] : 1));
});
