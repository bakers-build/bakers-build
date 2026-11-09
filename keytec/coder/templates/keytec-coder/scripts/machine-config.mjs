#!/usr/bin/env node
// Writes the entries of ~/.bakers/machine.config.js this template owns (README › Machine config):
//   bakers-machine-config [--frp <zone>]
// It owns the Claude and Codex addon entries and, with --frp, the addon-ports entry over frp (its
// admin credentials read from ~/.config/frp/frpc.json) and `tunnel: true`, so runs get BB_TUNNEL=1.
// It owns only lines it marked; every other byte stays, and an entry or tunnel key written by hand
// wins. A missing file is created with a new machine_id and the workspace name as label.
// Forked from coder/bakers-ddev/scripts/preview-config.mjs. Any failure logs one line and exits 0,
// so it never fails the workspace start.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const MARK = '// keytec-coder';
const BEGIN = `${MARK}: begin`;
const END = `${MARK}: end`;
const PORTS = '@bakers-build/addon-ports';
const AGENTS = ['@bakers-build/addon-claude', '@bakers-build/addon-codex'];
const TUNNEL_LINE = ` tunnel: true, ${MARK}`;

const log = (msg) => console.log(`machine-config: ${msg}`);
const useOf = (entry) => (typeof entry === 'string' ? entry : entry?.use);

/**
 * The default export of `text` as JSON data, or null when it does not load. Imported in a child
 * node from a copy beside the machine file, so relative imports resolve, as the conductor reads it.
 */
function load(text, dir) {
  const copy = join(dir, `.machine.config.keytec-${process.pid}.mjs`);
  writeFileSync(copy, text, { mode: 0o600 }); // the machine file holds the frpc admin password
  try {
    const out = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "import { pathToFileURL } from 'node:url'; const m = await import(pathToFileURL(process.argv[1])); console.log('\\n' + JSON.stringify(m.default));",
        copy,
      ],
      { stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000, encoding: 'utf8' },
    );
    const value = JSON.parse(out.trimEnd().split('\n').pop()); // the file itself may log first
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  } finally {
    rmSync(copy, { force: true });
  }
}

/** JSON with object keys sorted, so two loaded configs compare by meaning. */
const canonical = (value) =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort()) : v,
  );

/**
 * The text without every line this script wrote. A created `addons: [` / `],` pair stays when the
 * user added entries of their own inside it. Null when a begin or end marker lacks its pair.
 */
function unmarked(text) {
  const out = [];
  let block = null;
  for (const line of text.split('\n')) {
    if (line.trim() === BEGIN) {
      if (block) return null;
      block = [];
    } else if (line.trim() === END) {
      if (!block) return null;
      const kept = block.filter((l) => !l.trimEnd().endsWith(MARK));
      if (kept.some((l) => !/^\s*(addons\s*:\s*\[|\],)\s*$/.test(l))) out.push(...kept);
      block = null;
    } else if (block) block.push(line);
    else if (!line.trimEnd().endsWith(MARK)) out.push(line);
  }
  return block ? null : out.join('\n');
}

/** The ports entry over frp, or null with a logged reason. */
function portsEntry(zone) {
  const clientConfigPath = join(homedir(), '.config', 'frp', 'frpc.json');
  let web;
  try {
    web = JSON.parse(readFileSync(clientConfigPath, 'utf8')).webServer;
  } catch {
    log(`${clientConfigPath} unreadable; no ports entry`);
    return null;
  }
  const transport = { zone, clientConfigPath, adminPort: web.port, adminUser: web.user, adminPassword: web.password };
  return { use: PORTS, with: { transport: { use: '@bakers-build/addon-ports-frp', with: transport } } };
}

/**
 * `base` (no marked lines) with the owned lines; `own` is its loaded config. Returns the text and
 * the entries it added, or null to leave the file.
 */
function edit(base, own, zone) {
  // The `export default {` line, outside comments: the first such line at the start of a line.
  const lines = base.split('\n');
  const head = lines.findIndex((l) => /^[ \t]*export[ \t]+default[ \t]*\{[ \t]*$/.test(l));
  if (head === -1) {
    log('machine.config.js has no `export default {` line; add the addons by hand');
    return null;
  }
  const present = new Set((Array.isArray(own.addons) ? own.addons : []).map(useOf));
  const added = AGENTS.filter((a) => !present.has(a));
  if (zone !== undefined) {
    if (present.has(PORTS)) log('machine.config.js has its own addon-ports entry; it wins');
    else {
      const ports = portsEntry(zone);
      if (ports) added.push(ports);
    }
  }
  const entryLines = added.map((e) => `  ${JSON.stringify(e)}, ${MARK}`);
  if (added.length && own.addons === undefined) {
    lines.splice(head + 1, 0, ` ${BEGIN}`, ' addons: [', ...entryLines, ' ],', ` ${END}`);
  } else if (added.length) {
    const at = lines.findIndex((l, i) => i > head && /^\s*["']?addons["']?\s*:\s*\[\s*$/.test(l));
    if (at === -1) {
      log('cannot place entries in the addons list (write it as `addons: [` on its own line); add them by hand');
      return null;
    }
    lines.splice(at + 1, 0, ...entryLines);
  }
  let tunnel = false;
  if (zone !== undefined && added.some((e) => useOf(e) === PORTS)) {
    if (own.tunnel !== undefined) log('machine.config.js sets tunnel itself; it wins');
    else {
      lines.splice(head + 1, 0, TUNNEL_LINE);
      tunnel = true;
    }
  }
  return { text: lines.join('\n'), added, tunnel };
}

function main() {
  const args = process.argv.slice(2);
  const zone = args[0] === '--frp' ? args[1] : undefined;
  if (args[0] === '--frp' && !zone) return log('--frp needs a zone; machine.config.js unchanged');
  const path = join(process.env.BB_HOME || join(homedir(), '.bakers'), 'machine.config.js');
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const exists = existsSync(path);
  const label = JSON.stringify(process.env.WORKSPACE_NAME || 'coder');
  const text = exists
    ? readFileSync(path, 'utf8')
    : `// @bakers-schema-version 1\nexport default {\n schema_version: 1,\n machine_id: '${randomUUID()}',\n label: ${label},\n};\n`;
  const base = unmarked(text);
  if (base === null) return log(`${path} has a begin or end marker without its pair; remove the marked lines by hand`);
  const own = load(base, dir);
  if (!own) return log(`${path} does not load; left unchanged`);
  const result = edit(base, own, zone);
  if (!result) return;
  if (exists && result.text === text) return;
  const want = { ...own, ...(result.tunnel ? { tunnel: true } : {}) };
  if (result.added.length) want.addons = [...result.added, ...(own.addons ?? [])];
  if (canonical(load(result.text, dir)) !== canonical(want)) {
    return log(`cannot place the entries so they take effect; add them by hand; ${path} left unchanged`);
  }
  const tmp = `${path}.keytec-${process.pid}`;
  writeFileSync(tmp, result.text, { mode: 0o600 });
  renameSync(tmp, path);
  log(`${path} written${zone ? ` with frp (${zone})` : ''}`);
}

try {
  main();
} catch (err) {
  log(`failed: ${err.message}`);
}
