#!/usr/bin/env node
// Writes the preview transport parameter into machine.config.js (README › Optional previews):
//   bakers-preview-config <none|cloudflare-quick|cloudflare|frp> [path]
// It owns only lines it marked: a `tunnel: true` line and, for Cloudflare Quick, an addon-ports
// block. Every other byte stays. A hand-written tunnel key or addon-ports entry wins. Any
// failure logs a line and exits 0, so it never fails the workspace start.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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
  writeFileSync(copy, text);
  try {
    execFileSync(process.execPath, ['--check', copy], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  } finally {
    rmSync(copy, { force: true });
  }
}

/** The brace depth at the start of each line, skipping strings and comments. */
function lineDepths(text) {
  const depths = [0];
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\n') depths.push(depth);
    else if (c === '/' && text[i + 1] === '/') {
      while (i + 1 < text.length && text[i + 1] !== '\n') i++;
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 1;
      for (; i < stop; i++) if (text[i + 1] === '\n') depths.push(depth);
    } else if (c === '"' || c === "'" || c === '`') {
      for (i++; i < text.length && text[i] !== c; i++) if (text[i] === '\\') i++;
    } else if (c === '{' || c === '[' || c === '(') depth++;
    else if (c === '}' || c === ']' || c === ')') depth--;
  }
  return depths;
}

/** The text without every line the parameter wrote. */
function unmarked(text) {
  const out = [];
  let inBlock = false;
  for (const line of text.split('\n')) {
    if (line.trim() === BEGIN) inBlock = true;
    else if (line.trim() === END) inBlock = false;
    else if (!inBlock && !line.trimEnd().endsWith(MARK)) out.push(line);
  }
  return out.join('\n');
}

function edit(text, transport) {
  const base = unmarked(text);
  if (transport === 'none') return base;
  const lines = base.split('\n');
  const depths = lineDepths(base);
  const top = (re) => lines.findIndex((l, i) => depths[i] === 1 && re.test(l));
  const head = lines.findIndex((l) => /^\s*export\s+default\s*\{\s*$/.test(l));
  if (head === -1) {
    log('machine.config.js has no `export default {` line; add tunnel and the ports entry by hand');
    return base;
  }
  const hasPorts = /['"]@bakers-build\/addon-ports['"]/.test(base);
  if (transport === 'cloudflare-quick') {
    const block = [` ${BEGIN}`, ` ${QUICK_ENTRY}`, ` ${END}`];
    const addons = top(/^\s*addons\s*:/);
    if (hasPorts) log('machine.config.js has its own addon-ports entry; it wins over the parameter');
    else if (addons === -1) lines.splice(head + 1, 0, ' addons: [', ...block, ' ],');
    else if (/^\s*addons\s*:\s*\[\s*$/.test(lines[addons])) lines.splice(addons + 1, 0, ...block);
    else log('cannot place the ports entry in the addons list; add it by hand');
  } else if (!hasPorts) {
    log(`no addon-ports entry for ${transport}; add the ports entry by hand (README › Optional previews)`);
  }
  if (top(/^\s*tunnel\s*:/) !== -1) log('machine.config.js sets tunnel itself; it wins over the parameter');
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
  writeFileSync(tmp, next);
  renameSync(tmp, path);
  log(`${path} set for ${transport}`);
}

try {
  main();
} catch (err) {
  log(`failed: ${err.message}`);
}
