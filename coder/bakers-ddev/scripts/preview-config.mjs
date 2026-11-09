#!/usr/bin/env node
// Writes the preview transport parameter into machine.config.js (README › Optional previews):
//   bakers-preview-config <none|cloudflare-quick|cloudflare|frp> [path]
// It owns only lines it marked: a `tunnel: true` line and, for Cloudflare Quick, an addon-ports
// block. Every other byte stays. A hand-written tunnel key or addon-ports entry wins. Any
// failure logs a line and exits 0, so it never fails the workspace start.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const MARK = '// bakers-ddev preview';
const BEGIN = `${MARK}: begin`;
const END = `${MARK}: end`;
const PORTS = '@bakers-build/addon-ports';
const QUICK = { use: PORTS, with: { transport: { use: '@bakers-build/addon-ports-cloudflare-quick' } } };
const QUICK_ENTRY =
  " { use: '@bakers-build/addon-ports', with: { transport: { use: '@bakers-build/addon-ports-cloudflare-quick' } } },";
const TUNNEL_LINE = ` tunnel: true, ${MARK}`;
const TRANSPORTS = ['none', 'cloudflare-quick', 'cloudflare', 'frp'];
const NEW_FILE = '// @bakers-schema-version 1\nexport default {\n schema_version: 1,\n};\n';

const log = (msg) => console.log(`preview: ${msg}`);

/**
 * The default export of `text` as JSON data, or null when it does not load. Imported in a child
 * node from a copy beside the machine file, so relative imports resolve, as the conductor reads it.
 */
function load(text, dir) {
  const copy = join(dir, `.machine.config.preview-${process.pid}.mjs`);
  writeFileSync(copy, text, { mode: 0o600 }); // the machine file may hold secrets
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

/** Whether `text` parses as a module; it runs nothing. */
function parses(text) {
  try {
    execFileSync(process.execPath, ['--input-type=module', '--check'], { input: text, stdio: ['pipe', 'ignore', 'ignore'], timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

/** JSON with object keys sorted, so two loaded configs compare by meaning. */
const canonical = (value) =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort()) : v,
  );

/**
 * The text with comments and string contents blanked to spaces, newlines kept; a string used as a
 * property key stays. Null when a string or comment never closes, a quoted string crosses a line,
 * or the text holds a `/` that starts no comment or a `${` in a template. shortcut: it ends a `//`
 * comment only at `\n` and sees no computed or spread keys; the import check in main() catches a
 * misplaced key, upgrade to a JS parser if hand files often need that check.
 */
function scan(text) {
  let blank = '';
  const colon = /\s*:/y;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i);
      const stop = end === -1 ? text.length : end;
      blank += ' '.repeat(stop - i);
      i = stop - 1;
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end === -1) return null;
      const stop = end + 2;
      blank += text.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop - 1;
    } else if (c === '/') {
      return null; // a regex literal or division
    } else if (c === '"' || c === "'" || c === '`') {
      let end = i + 1;
      for (; end < text.length && text[end] !== c; end++) {
        if (text[end] === '\\') end++;
        else if (c === '`' && text[end] === '$' && text[end + 1] === '{') return null;
      }
      if (end >= text.length) return null;
      const str = text.slice(i, end + 1);
      // An unescaped newline ends no quoted string in JS: a stray quote opened this one.
      if (c !== '`' && /(?<!\\)\n/.test(str)) return null;
      colon.lastIndex = end + 1;
      const key = c !== '`' && colon.test(text);
      blank += key ? str : c + str.slice(1, -1).replace(/[^\n]/g, ' ') + c;
      i = end;
    } else {
      blank += c;
    }
  }
  return blank;
}

/**
 * The offset of `key` (quoted, shorthand or on a shared line) in `blank` as a key of the object that
 * opens at `start`, the `export default {` line, or -1.
 */
function topKey(blank, key, start) {
  for (const m of blank.matchAll(new RegExp(`(?<=(?:^|[{,])\\s*)(["']?)${key}\\1\\s*(?=[:,}])`, 'gm'))) {
    if (m.index < start) continue;
    let depth = 0;
    for (const ch of blank.slice(start, m.index)) {
      if ('{[('.includes(ch)) depth++;
      else if ('}])'.includes(ch) && --depth === 0) return -1; // past the exported object
    }
    if (depth === 1) return m.index;
  }
  return -1;
}

/**
 * The text without every line the parameter wrote. A created `addons: [` / `],` pair stays when
 * the user added entries of their own inside it. Null when a begin or end marker lacks its pair.
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
      const kept = block.filter((l) => l.trim() !== QUICK_ENTRY.trim());
      const own = kept.filter((l) => !/^\s*(addons\s*:\s*\[|\],)\s*$/.test(l));
      if (own.length) out.push(...kept);
      block = null;
    } else if (block) block.push(line);
    else if (!line.trimEnd().endsWith(MARK)) out.push(line);
  }
  return block ? null : out.join('\n');
}

/** `base` (no marked lines) with the transport's lines; `own` is its loaded config. Null: leave the file. */
function edit(base, transport, own) {
  const blank = scan(base);
  if (blank === null) {
    log('cannot read machine.config.js; add tunnel and the ports entry by hand');
    return null;
  }
  const start = blank.search(/^[ \t]*export[ \t]+default[ \t]*\{[ \t]*$/m);
  if (start === -1) {
    log('machine.config.js has no `export default {` line; add tunnel and the ports entry by hand');
    return null;
  }
  const lines = base.split('\n');
  const head = blank.slice(0, start).split('\n').length - 1;
  const hasPorts = Array.isArray(own.addons) && own.addons.some((a) => a?.use === PORTS);
  if (transport === 'cloudflare-quick') {
    const addons = topKey(blank, 'addons', start);
    if (hasPorts) log('machine.config.js has its own addon-ports entry; it wins over the parameter');
    // A created addons key sits inside the markers, so none removes it with the entry.
    else if (addons === -1) lines.splice(head + 1, 0, ` ${BEGIN}`, ' addons: [', ` ${QUICK_ENTRY}`, ' ],', ` ${END}`);
    else if (/^["']?addons["']?\s*:\s*\[\s*$/.test(blank.slice(addons).split('\n')[0])) {
      lines.splice(blank.slice(0, addons).split('\n').length, 0, ` ${BEGIN}`, ` ${QUICK_ENTRY}`, ` ${END}`);
    } else log('cannot place the ports entry in the addons list; add it by hand');
  } else if (!hasPorts) {
    log(`no addon-ports entry for ${transport}; add the ports entry by hand (README › Optional previews)`);
  }
  if (own.tunnel !== undefined) log('machine.config.js sets tunnel itself; it wins over the parameter');
  else lines.splice(head + 1, 0, TUNNEL_LINE);
  return lines.join('\n');
}

/** The config `next` must load as: `own` plus what the marked lines in `next` set. */
function intended(own, next) {
  const want = { ...own };
  if (next.includes(TUNNEL_LINE)) want.tunnel = true;
  if (next.includes(BEGIN)) want.addons = [QUICK, ...(own.addons ?? [])];
  return want;
}

function main() {
  const [transport, path = join(process.env.BB_HOME || join(homedir(), '.bakers'), 'machine.config.js')] =
    process.argv.slice(2);
  if (!TRANSPORTS.includes(transport)) return log(`unknown transport "${transport}"; machine.config.js unchanged`);
  const exists = existsSync(path);
  if (!exists && transport === 'none') return;
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const text = exists ? readFileSync(path, 'utf8') : NEW_FILE;
  const base = unmarked(text);
  if (base === null) return log(`${path} has a begin or end marker without its pair; remove the marked lines by hand; left unchanged`);
  let next = base;
  if (transport === 'none') {
    if (next === text) return;
    // none only removes lines this script marked, so a syntax check does without importing a file this environment may not load.
    if (!parses(next)) return log(`${path} would not parse; left unchanged`);
  } else {
    const own = load(base, dir);
    if (!own) return log(`${path} does not load; left unchanged`);
    next = edit(base, transport, own);
    if (next === null || (exists && next === text)) return;
    if (canonical(load(next, dir)) !== canonical(intended(own, next))) {
      return log(`cannot place tunnel and the ports entry so they take effect; add them by hand; ${path} left unchanged`);
    }
  }
  const tmp = `${path}.preview-${process.pid}`;
  writeFileSync(tmp, next, { mode: exists ? statSync(path).mode & 0o777 : 0o644 });
  renameSync(tmp, path);
  log(`${path} set for ${transport}`);
}

try {
  main();
} catch (err) {
  log(`failed: ${err.message}`);
}
