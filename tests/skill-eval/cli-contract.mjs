// Real-CLI contract boundary: literal argv through the checked-out bakers.build launcher against one
// disposable loopback MCP fixture. No shell, no PATH lookup, no tracker, no model.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = realpathSync(join(here, '..', '..'));
const cliRoot = join(repoRoot, 'bakers-cli');
export const launcher = join(cliRoot, 'bin', 'bakers');
const guard = join(here, 'cli-origin-guard.cjs');
const basicToken = Buffer.from('contract-fixture:contract-fixture').toString('base64');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const inside = path => !relative(repoRoot, path).startsWith('..');

// The bakers tool definitions (tools/list) shared with the simulator: names, input and output
// schemas as Drupal serves them. They define this contract's fixture, not the live site, whose
// freshness remains outside this boundary.
export const contractFixture = JSON.parse(readFileSync(join(here, 'contract-fixture.json'), 'utf8'));

/** Endpoint state for a simulator fixture: the same tickets, comments and faults the simulator holds. */
export const endpointSeed = (simulation, faults = {}) => ({ simulation, faults });

/** Executable identity of the tested repository CLI; throws instead of falling back elsewhere. */
export function cliIdentity(launcherPath = launcher) {
  const git = args => spawnSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' });
  const commit = git(['rev-parse', 'HEAD']);
  const status = git(['status', '--porcelain']);
  if (commit.status !== 0 || status.status !== 0) throw new Error(`CLI_IDENTITY: git revision unavailable: ${commit.stderr}${status.stderr}`);
  const files = {
    launcher: launcherPath,
    host: join(cliRoot, 'host', 'dist', 'src', 'host.js'),
    addon_dropsh: join(cliRoot, 'addons', 'dropsh', 'dist', 'src', 'index.js'),
    addon_essentials: join(cliRoot, 'addons', 'essentials', 'dist', 'src', 'index.js'),
    addon_name_refs: join(cliRoot, 'addons', 'name-refs', 'dist', 'src', 'index.js'),
    addon_auth_basic: join(cliRoot, 'addons', 'auth-basic', 'dist', 'src', 'index.js'),
  };
  const packages = {};
  for (const [name, from] of [['dropsh', 'addons/dropsh'], ['@dropsh/plugin-jsonapi-schema', 'addons/essentials'],
    ['@dropsh/plugin-markdown', 'addons/essentials'], ['@bakers-build/addon-name-refs', 'addons/essentials'],
    ['@dropsh/plugin-tool', 'addons/dropsh']]) {
    const path = realpathSync(join(cliRoot, from, 'node_modules', name, 'package.json'));
    packages[name] = { path, version: JSON.parse(readFileSync(path, 'utf8')).version };
  }
  const hashes = {};
  for (const [name, path] of Object.entries(files)) {
    let real;
    try { real = realpathSync(path); }
    catch { throw new Error(`CLI_IDENTITY: missing build artifact ${path}; run cd bakers-cli && pnpm install && pnpm -r run build`); }
    hashes[name] = { path: real, sha256: sha256(readFileSync(real)) };
  }
  for (const entry of [...Object.values(hashes), ...Object.values(packages)]) {
    if (!inside(entry.path)) throw new Error(`CLI_IDENTITY: ${entry.path} resolves outside ${repoRoot}`);
  }
  return {
    repository: repoRoot, commit: commit.stdout.trim(), dirty: status.stdout.trim() !== '',
    runtime: { path: process.execPath, version: process.version },
    package_version: JSON.parse(readFileSync(join(cliRoot, 'host', 'package.json'), 'utf8')).version,
    files: hashes, packages,
  };
}

class Refused extends Error {}
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const pick = (record, keys) => Object.fromEntries(keys.map(k => [k, record[k] ?? null]));

/** The Drupal tools' behavior over fixture state; an independent model of what the simulator implements. */
function toolModel(simulation) {
  const sim = structuredClone(simulation);
  const tickets = [sim.ticket, sim.prior_art, contractFixture.probe_ticket].filter(Boolean)
    .map(t => ({ labels: [], links: [], ...structuredClone(t) }));
  const comments = sim.comments ?? [];
  const worklogs = sim.worklogs ?? [];
  let created = 0, submissions = 0;
  const find = ref => tickets.find(t => t.id === ref || t.identifier === ref) ??
    (() => { throw new Refused(`Ticket ${ref} does not exist or is not readable.`); })();
  const project = ref => { if (![contractFixture.project, contractFixture.project_key].includes(ref)) throw new Refused(`Project ${ref} does not exist or is not readable.`); };
  // Term names (type, recipe, label) are reused or created: the fixture caller may create terms.
  const tools = {
    project_list: a => {
      const limit = a.limit ?? 50, offset = a.offset ?? 0;
      if (limit < 1 || limit > 100 || offset < 0) throw new Refused('limit must be 1-100 and offset 0 or more.');
      const rows = (sim.projects ?? []).filter(p => (!a.workspace || p.workspace === a.workspace) &&
        (!a.group || p.group === a.group) && p.name.toLowerCase().includes((a.query ?? '').toLowerCase()))
        .sort((a, b) => a.name.localeCompare(b.name) || a.uuid.localeCompare(b.uuid));
      return { projects: rows.slice(offset, offset + limit).map(p => pick(p, ['uuid', 'key', 'name', 'group'])),
        next_offset: rows.length > offset + limit ? offset + limit : null };
    },
    ticket_classify: a => {
      if (!a.type && !a.recipe) throw new Refused('Give a recipe or a type.');
      const t = find(a.ticket);
      for (const field of ['type', 'recipe']) if (a[field]) t[field] = a[field];
      return { type: t.type ?? null, recipe: t.recipe ?? null };
    },
    ticket_read: a => {
      const t = find(a.ticket);
      return { ...pick(t, ['id', 'identifier', 'title', 'state', 'workflow', 'description', 'type', 'recipe', 'branch_name', 'conductor']), labels: t.labels, links: t.links, reviewers: structuredClone(t.reviewers ?? []),
        project: contractFixture.project, base_branch: t.base_branch ?? 'main', frozen: Boolean(t.frozen), metrics: structuredClone(t.metrics ?? []),
        comments: comments.filter(c => c.ticket === t.id).map(c => ({ id: c.id, type: c.type, body: c.body,
          created: c.created ?? '2026-01-01T00:00:00+00:00', author: c.author ?? 'fixture-agent' })) };
    },
    ticket_search: a => {
      if (a.project) project(a.project);
      const q = (a.query ?? '').toLowerCase(), branch = a.branch_name;
      if (!q && !branch) throw new Refused('Give a query or a branch_name.');
      return { tickets: [...tickets].reverse()
        .filter(t => (!q || (t.title ?? '').toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q)) && (!branch || t.branch_name === branch))
        .slice(0, 50).map(t => ({ ...pick(t, ['identifier', 'title', 'state', 'type', 'branch_name']), base_branch: t.base_branch ?? 'main',
          parent: tickets.find(p => p.id === t.parent)?.identifier ?? null })) };
    },
    ticket_update: a => {
      if (['title', 'description', 'conductor', 'labels_add', 'labels_remove', 'frozen'].every(f => a[f] == null)) {
        throw new Refused('Give a title, a description, a conductor, labels to add or remove, or frozen.');
      }
      const removed = a.labels_remove ?? [];
      const both = (a.labels_add ?? []).find(label => removed.includes(label));
      if (both !== undefined) throw new Refused(`Label ${both} is both added and removed.`);
      const t = find(a.ticket);
      for (const f of ['title', 'description', 'conductor', 'frozen']) if (a[f] != null) t[f] = a[f];
      for (const label of a.labels_add ?? []) if (!t.labels.includes(label)) t.labels.push(label);
      t.labels = t.labels.filter(label => !removed.includes(label));
      return { ...pick(t, ['identifier', 'title', 'description', 'conductor']), labels: [...t.labels], frozen: Boolean(t.frozen) };
    },
    ticket_create: a => {
      project(a.project);
      const parent = a.parent ? find(a.parent).id : null;
      created += 1;
      const t = { id: `33333333-3333-4333-8333-${String(created).padStart(12, '0')}`, identifier: `EVAL-${100 + created}`, title: a.title,
        state: 'qualification', workflow: a.workflow, description: a.description ?? null, type: a.type || null, recipe: a.recipe || null,
        labels: [], links: [], parent, branch_name: a.branch_name || `feat/eval-${100 + created}` };
      tickets.push(t);
      return pick(t, ['id', 'identifier', 'state', 'branch_name']);
    },
    ticket_transition: a => {
      const state = a.state ?? '', links = a.links ?? [];
      if (!state && !links.length) throw new Refused('Give a target state or links to add.');
      const t = find(a.ticket);
      if (state && sim.reject_transition) throw new Refused(`Ticket ${a.ticket} cannot move from ${t.state} to ${state}.`);
      if (state) t.state = state;
      for (const link of links) if (!t.links.some(l => l.uri === link.uri)) t.links.push({ uri: link.uri, title: link.title ?? '' });
      return { state: t.state, links: structuredClone(t.links) };
    },
    comment_publish: a => {
      const t = find(a.ticket);
      const comment = { id: `22222222-2222-4222-8222-${String(comments.length + 1).padStart(12, '0')}`, ticket: t.id, type: a.type, body: a.body };
      comments.push(comment);
      return { id: comment.id, type: comment.type };
    },
    metric_write: a => {
      const prefix = `${a.name}.`;
      const outside = a.rows.find(r => !r.name.startsWith(prefix));
      if (outside) throw new Refused(`Row ${outside.name} is not in the ${prefix} namespace.`);
      const t = find(a.ticket);
      t.metrics = [...(t.metrics ?? []).filter(m => !m.name.startsWith(prefix)), ...a.rows.map(r => ({ name: r.name, value: r.value, unit: r.unit ?? null }))];
      if (a.label) {
        if (!t.labels.includes(a.label)) t.labels.push(a.label);
      }
      return { metrics: structuredClone(t.metrics) };
    },
    time_propose: a => {
      a.entries.forEach((e, i) => {
        if (!DATE.test(e.work_date) || e.duration_seconds < 60 || e.duration_seconds > 86400 || e.duration_seconds % 60 || e.description.length > 2000) {
          throw new Refused(`Entry ${i + 1} (${e.source_key}) is invalid: work_date Y-m-d, whole minutes from 60 to 86400 seconds, at most 2000 characters.`);
        }
      });
      submissions += 1;
      const submission = `aaaaaaaa-aaaa-4aaa-8aaa-${String(submissions).padStart(12, '0')}`;
      const ids = a.entries.map(e => {
        const id = `bbbbbbbb-bbbb-4bbb-8bbb-${String(worklogs.length + 1).padStart(12, '0')}`;
        worklogs.push({ id, work_date: e.work_date, state: 'proposed', duration_seconds: e.duration_seconds, description: e.description, source_keys: [],
          project_id: e.project || a.project || contractFixture.project, ticket_id: e.ticket ?? null, submission_id: submission });
        return id;
      });
      return { submission, worklogs: ids };
    },
    worklog_list: a => {
      const limit = a.limit ?? 50, offset = a.offset ?? 0;
      if (!DATE.test(a.from) || !DATE.test(a.to) || a.from > a.to || limit < 1 || limit > 50 || offset < 0) {
        throw new Refused('Give from <= to as Y-m-d, limit 1 to 50 and a non-negative offset.');
      }
      const rows = worklogs.filter(w => a.from <= w.work_date && w.work_date <= a.to);
      const page = structuredClone(rows.slice(offset, offset + limit));
      return { data: page,
        projects: [...new Set(page.map(w => w.project_id).filter(Boolean))].sort().map(id => ({ id, name: 'fixture' })),
        tickets: tickets.filter(t => page.some(w => w.ticket_id === t.id)).map(t => ({ id: t.id, identifier: t.identifier ?? null, title: t.title ?? null, project_id: contractFixture.project })),
        omitted: false, next_offset: rows.length > offset + limit ? offset + limit : null };
    },
  };
  return { tickets, comments, call: (name, args) => tools[name.replace(/^tool_api__bakers_/, '')](args) };
}

/**
 * One disposable MCP endpoint (JSON-RPC over HTTP at /mcp) per case, serving the shared tool
 * definitions. State is fixed synthetic data; faults are named and explicit. Every request is
 * recorded with raw bytes and decoded JSON; an unmodeled route or method fails the case.
 */
export async function startEndpoint(seed = {}) {
  const faults = { ...seed.faults };
  const model = toolModel(seed.simulation ?? {});
  const requests = [];
  const unknown = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const url = new URL(req.url, 'http://fixture.invalid');
      let decoded;
      try { decoded = raw ? JSON.parse(raw) : undefined; } catch { decoded = { unparseable: raw }; }
      const record = { method: req.method, path: url.pathname, raw, json: decoded,
        authorization: req.headers.authorization === `Basic ${basicToken}` };
      requests.push(record);
      const send = (status, body) => {
        record.status = status;
        record.response = body;
        res.writeHead(status, body === undefined ? {} : { 'Content-Type': 'application/json' });
        res.end(body === undefined ? '' : JSON.stringify(body));
      };
      if (!record.authorization) return send(401, { error: 'fixture credential required' });
      if (url.pathname !== '/mcp') { unknown.push(record); return send(404, { error: 'unmodeled fixture route' }); }
      if (faults.redirect) {
        record.status = 302;
        res.writeHead(302, { Location: faults.redirect });
        return res.end();
      }
      // No server-initiated stream: the client tolerates 405 on its optional GET.
      if (req.method === 'GET') return send(405);
      if (req.method !== 'POST' || !decoded?.method) { unknown.push(record); return send(405); }
      if (decoded.id === undefined) return send(202);
      const reply = result => send(200, { jsonrpc: '2.0', id: decoded.id, result });
      if (decoded.method === 'initialize') {
        return reply({ protocolVersion: decoded.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'bakers-contract-fixture', version: '1' } });
      }
      if (decoded.method === 'tools/list') return reply({ tools: contractFixture.tools });
      if (decoded.method !== 'tools/call' || !contractFixture.tools.some(t => t.name === decoded.params?.name)) {
        unknown.push(record);
        return send(200, { jsonrpc: '2.0', id: decoded.id, error: { code: -32601, message: 'unmodeled fixture method' } });
      }
      const { name, arguments: args } = decoded.params;
      record.tool = name;
      let output;
      try { output = model.call(name, args ?? {}); }
      catch (error) {
        if (!(error instanceof Refused)) throw error;
        return reply({ content: [{ type: 'text', text: error.message }], isError: true });
      }
      if (faults.lostResponse && name === 'tool_api__bakers_comment_publish') {
        if (faults.lostResponse === 'unapplied') model.comments.pop();
        record.status = 'connection-closed';
        record.applied = faults.lostResponse !== 'unapplied';
        return req.socket.destroy();
      }
      return reply({ content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: output });
    });
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin, state: model, requests, unknown, faults,
    /** The tools/call requests that reached the endpoint, in order. */
    calls: () => requests.filter(r => r.json?.method === 'tools/call'),
    close: () => new Promise(done => { server.closeAllConnections?.(); server.close(() => done()); }),
  };
}

/** Allowlisted environment; nothing from the parent process (credentials, selectors, NODE_OPTIONS) leaks. */
export function contractEnvironment(root, origin) {
  return { HOME: join(root, 'home'), TMPDIR: join(root, 'tmp'), LANG: 'C.UTF-8', NO_COLOR: '1',
    BB_CONTRACT_ALLOWED_ORIGIN: origin };
}

/**
 * Execute argv (beginning with bakers) through the absolute repository launcher, without a
 * shell. Runner-owned virtual files are materialized under the disposable root, keyed by the same
 * virtual path the simulator receives; argv references them as @<virtual path>.
 */
export async function runCli(argv, { origin, files = {}, timeoutMs = 30000 } = {}) {
  if (argv[0] !== 'bakers') throw new Error('CLI_CONTRACT: argv must begin with bakers');
  const root = mkdtempSync(join(tmpdir(), 'bakers-cli-contract-'));
  try {
    const work = join(root, 'work');
    for (const dir of ['home', 'tmp', join('work', '.bakers')]) mkdirSync(join(root, dir), { recursive: true });
    const auth = join(cliRoot, 'addons', 'auth-basic', 'dist', 'src', 'index.js');
    const essentials = join(cliRoot, 'addons', 'essentials', 'dist', 'src', 'index.js');
    writeFileSync(join(work, '.bakers', 'connection.config.js'),
      `import basic from ${JSON.stringify(auth)};\nexport default { schema_version: 1, site: { base_url: ${JSON.stringify(origin)}, jsonapi_prefix: '/jsonapi' }, plugins: [{ plugin: ${JSON.stringify(essentials)} }, basic(${JSON.stringify(basicToken)})] };\n`);
    const materialized = argv.map(token => {
      for (const [virtual, content] of Object.entries(files)) {
        const at = token.indexOf(`@${virtual}`);
        if (at >= 0 && token.slice(at + 1) === virtual) {
          const path = join(root, 'files', virtual.replace(/^\/+/, ''));
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, content);
          return `${token.slice(0, at)}@${path}`;
        }
      }
      return token;
    });
    const child = spawn(process.execPath, ['--require', guard, launcher, ...materialized.slice(1)],
      { cwd: work, env: contractEnvironment(root, origin), shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [];
    const err = [];
    child.stdout.on('data', c => out.push(c));
    child.stderr.on('data', c => err.push(c));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    const code = await new Promise(done => child.on('close', (status, signal) => done(signal ? `signal:${signal}` : status)));
    clearTimeout(timer);
    const stdout = Buffer.concat(out).toString('utf8').replaceAll(root, '<contract-root>');
    const stderr = Buffer.concat(err).toString('utf8').replaceAll(root, '<contract-root>');
    return { exit_code: code, stdout, stderr };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Run tool calls through the existing stdio MCP simulator and return its per-call results. */
export async function runSimulator(simulation, calls) {
  const root = mkdtempSync(join(tmpdir(), 'bakers-sim-contract-'));
  try {
    const fixture = join(root, 'fixture.json');
    writeFileSync(fixture, JSON.stringify({ simulation }));
    const requests = [{ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
      ...calls.map((call, i) => ({ jsonrpc: '2.0', id: i + 1, method: 'tools/call', params: call }))];
    const result = spawnSync('python3', ['-B', join(here, 'tool-server.py'), '--fixture', fixture, '--trace', join(root, 'trace.jsonl')],
      { input: `${requests.map(r => JSON.stringify(r)).join('\n')}\n`, encoding: 'utf8', timeout: 30000 });
    if (result.status !== 0) throw new Error(`SIMULATOR: exit ${result.status}: ${result.stderr}`);
    return result.stdout.trim().split('\n').slice(1).map(line => JSON.parse(JSON.parse(line).result.content[0].text));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
