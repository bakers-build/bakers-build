#!/usr/bin/env node
// Writes the preview transport parameter into machine.config.js (README › Optional previews):
//   bakers-preview-config <none|cloudflare-quick|cloudflare|frp> [path]
// It owns only lines it marked: a `tunnel: true` line and, for Cloudflare Quick, an addon-ports
// block. Every other byte stays. A hand-written tunnel key or addon-ports entry wins. Any
// failure logs a line and exits 0, so it never fails the workspace start.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const MARK = '// bakers-ddev preview';
const BEGIN = `${MARK}: begin`;
const END = `${MARK}: end`;
const QUICK_ENTRY =
  " { use: '@bakers-build/addon-ports', with: { transport: { use: '@bakers-build/addon-ports-cloudflare-quick' } } },";
const TRANSPORTS = ['none', 'cloudflare-quick', 'cloudflare', 'frp'];
const NEW_FILE = '// @bakers-schema-version 1\nexport default {\n schema_version: 1,\n};\n';

const log = (msg) => console.log(`preview: ${msg}`);

/** Whether `text` parses as a module; checked on a copy, the file itself never runs. */
function parses(text) {
  const copy = join(tmpdir(), `bakers-preview-${process.pid}.mjs`);
  writeFileSync(copy, text, { mode: 0o600 }); // the machine file may hold secrets
  try {
    execFileSync(process.execPath, ['--check', copy], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  } finally {
    rmSync(copy, { force: true });
  }
}

/**
 * The text without its comments (`code`), and the text with comments and string contents blanked
 * to spaces, newlines kept (`blank`); a string used as a property key stays. Null when a string
 * or comment never closes, a quoted string crosses a line, or the text holds a `/` that starts no
 * comment or a `${` in a template: only a regex literal or a template expression can hide a quote
 * from this scan, so without them a file that parses has no stray quote. Division reads as lost too.
 */
function scan(text) {
  let code = '';
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
      code += str;
      blank += key ? str : c + str.slice(1, -1).replace(/[^\n]/g, ' ') + c;
      i = end;
    } else {
      code += c;
      blank += c;
    }
  }
  return { code, blank };
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
 * the user added entries of their own inside it.
 */
function unmarked(text) {
  const out = [];
  let block = null;
  for (const line of text.split('\n')) {
    if (line.trim() === BEGIN) block = [];
    else if (line.trim() === END) {
      const kept = block.filter((l) => l.trim() !== QUICK_ENTRY.trim());
      const own = kept.filter((l) => !/^\s*(addons\s*:\s*\[|\],)\s*$/.test(l));
      if (own.length) out.push(...kept);
      block = null;
    } else if (block) block.push(line);
    else if (!line.trimEnd().endsWith(MARK)) out.push(line);
  }
  return out.join('\n');
}

function edit(text, transport) {
  const base = unmarked(text);
  if (transport === 'none') return base;
  const lines = base.split('\n');
  const scanned = scan(base);
  if (!scanned) {
    log('cannot read machine.config.js; add tunnel and the ports entry by hand');
    return base;
  }
  const { code, blank } = scanned;
  const start = blank.search(/^[ \t]*export[ \t]+default[ \t]*\{[ \t]*$/m);
  if (start === -1) {
    log('machine.config.js has no `export default {` line; add tunnel and the ports entry by hand');
    return base;
  }
  const head = blank.slice(0, start).split('\n').length - 1;
  const hasPorts = /['"]@bakers-build\/addon-ports['"]/.test(code);
  // Looked up before any splice below, which shifts lines against blank.
  const ownTunnel = topKey(blank, 'tunnel', start) !== -1;
  if (transport === 'cloudflare-quick') {
    const block = [` ${BEGIN}`, ` ${QUICK_ENTRY}`, ` ${END}`];
    const addons = topKey(blank, 'addons', start);
    const rest = blank.slice(addons).split('\n')[0];
    if (hasPorts) log('machine.config.js has its own addon-ports entry; it wins over the parameter');
    // A created addons key sits inside the markers, so none removes it with the entry.
    else if (addons === -1) lines.splice(head + 1, 0, ` ${BEGIN}`, ' addons: [', ` ${QUICK_ENTRY}`, ' ],', ` ${END}`);
    else if (/^["']?addons["']?\s*:\s*\[\s*$/.test(rest)) {
      lines.splice(blank.slice(0, addons).split('\n').length, 0, ...block);
    } else log('cannot place the ports entry in the addons list; add it by hand');
  } else if (!hasPorts) {
    log(`no addon-ports entry for ${transport}; add the ports entry by hand (README › Optional previews)`);
  }
  if (ownTunnel) log('machine.config.js sets tunnel itself; it wins over the parameter');
  else lines.splice(head + 1, 0, ` tunnel: true, ${MARK}`);
  return lines.join('\n');
}

function main() {
  const [transport, path = join(process.env.BB_HOME || join(homedir(), '.bakers'), 'machine.config.js')] =
    process.argv.slice(2);
  if (!TRANSPORTS.includes(transport)) return log(`unknown transport "${transport}"; machine.config.js unchanged`);
  const exists = existsSync(path);
  if (!exists && transport === 'none') return;
  const text = exists ? readFileSync(path, 'utf8') : NEW_FILE;
  if (!parses(text)) return log(`${path} does not parse; left unchanged`);
  const next = edit(text, transport);
  if (exists && next === text) return;
  if (!parses(next)) return log(`the edited ${path} would not parse; left unchanged`);
  mkdirSync(dirname(path), { recursive: true });
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
