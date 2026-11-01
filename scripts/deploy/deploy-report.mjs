#!/usr/bin/env node
// Deploy report for the CI deploy job: print the server's own `deploy` service output and
// exit state (through the Komodo read API), then smoke-check the live host. Any failure
// exits non-zero, naming the failed check, so a broken deploy is never green.
//
//   node scripts/deploy/deploy-report.mjs <stack> <base-url> [<docs-url>]   # CI: log + exit state + smoke
//   node scripts/deploy/deploy-report.mjs --smoke-only <base-url> [<docs-url>]
//
// With <docs-url>, the docs host is checked too: root 200, marketplace.json 200, its plugin
// archive on the docs host and matching the pinned sha256.
//
// Env (full mode): KOMODO_URL, KOMODO_API_KEY, KOMODO_API_SECRET. Node >= 18 (global fetch).

import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
const smokeOnly = args[0] === '--smoke-only';
const [stack, baseUrl, docsUrl] = smokeOnly ? [null, ...args.slice(1)] : args;
if (!baseUrl || (!smokeOnly && !stack)) {
  console.error(
    'usage: deploy-report.mjs <stack> <base-url> [<docs-url>] | --smoke-only <base-url> [<docs-url>]',
  );
  process.exit(2);
}

const failures = [];
const check = (name, ok, detail) => {
  console.log(
    `[smoke] ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`,
  );
  if (!ok) failures.push(name);
};

async function komodo(type, params) {
  const res = await fetch(`${process.env.KOMODO_URL}/read`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': process.env.KOMODO_API_KEY ?? '',
      'X-Api-Secret': process.env.KOMODO_API_SECRET ?? '',
    },
    body: JSON.stringify({ type, params }),
  });
  if (!res.ok)
    throw new Error(`Komodo ${type}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

async function reportDeployService() {
  console.log(
    `[deploy] commit ${process.env.CI_COMMIT_SHA ?? '(unknown)'} on stack ${stack}`,
  );
  try {
    const log = await komodo('GetStackLog', {
      stack,
      services: ['deploy'],
      tail: 300,
      timestamps: false,
    });
    console.log(`----- ${log.command}\n${log.stdout}${log.stderr}-----`);
    const services = await komodo('ListStackServices', { stack });
    const status =
      services.find((s) => s.service === 'deploy')?.container?.status ??
      'no container';
    // A finished one-shot container reads "Exited (<code>) <age>".
    check('deploy service exited 0', /^Exited \(0\)/.test(status), status);
  } catch (err) {
    check('deploy service log and exit state', false, err.message);
  }
}

async function get(path, base = baseUrl) {
  return fetch(new URL(path, base), {
    redirect: 'manual',
    signal: AbortSignal.timeout(20000),
  });
}

async function smoke() {
  const probes = [
    // fetch verifies the certificate chain and host name, so TLS fails here first.
    ['TLS valid and sign-in page 200', '/user/login', (r) => r.status === 200],
    [
      'OAuth discovery 200',
      '/.well-known/oauth-authorization-server',
      (r) => r.status === 200,
    ],
    // Drupal's mcp_server demands a bearer before any tool runs.
    [
      '/mcp answers from mcp_server',
      '/mcp',
      (r) =>
        r.status === 401 &&
        /realm="mcp_server"/.test(r.headers.get('www-authenticate') ?? ''),
    ],
  ];
  const results = [];
  for (const [name, path, ok] of probes) {
    try {
      const res = await get(path);
      results.push([name, ok(res), `HTTP ${res.status}`]);
    } catch (err) {
      results.push([
        name,
        false,
        err.cause?.code ?? err.cause?.message ?? err.message,
      ]);
    }
  }
  if (docsUrl) results.push(...(await smokeDocs()));
  return results;
}

// The marketplace a user adds by URL downloads the archive its entry names: it must be on the
// docs host and match its sha256, or `/plugin install` refuses it.
async function smokeDocs() {
  const results = [];
  const probe = async (name, run) => {
    try {
      const [ok, detail] = await run();
      results.push([name, ok, detail]);
    } catch (err) {
      results.push([name, false, err.cause?.code ?? err.cause?.message ?? err.message]);
    }
  };
  await probe('docs site 200', async () => {
    const res = await get('/', docsUrl);
    return [res.status === 200, `HTTP ${res.status}`];
  });
  let archive;
  await probe('marketplace.json 200', async () => {
    const res = await get('/marketplace.json', docsUrl);
    if (res.status !== 200) return [false, `HTTP ${res.status}`];
    const catalog = await res.json();
    archive = catalog.plugins?.find((p) => p.name === 'bakers')?.source;
    return [archive?.source === 'archive', `bakers source ${JSON.stringify(archive)}`];
  });
  if (archive?.source !== 'archive') return results;
  const url = new URL(archive.url);
  const onHost = url.origin === new URL(docsUrl).origin;
  results.push(['marketplace archive on the docs host', onHost, archive.url]);
  if (!onHost) return results;
  await probe('marketplace archive matches its sha256', async () => {
    const res = await get(url, docsUrl);
    if (res.status !== 200) return [false, `HTTP ${res.status}`];
    const sha = createHash('sha256').update(Buffer.from(await res.arrayBuffer())).digest('hex');
    return [sha === archive.sha256?.toLowerCase(), `${sha} vs pinned ${archive.sha256}`];
  });
  return results;
}

// Warn-only: www.<apex> → 301 → apex needs its own DNS record, which may not exist yet.
// shortcut: an apex is a two-label host; upgrade to an explicit alias argument if a docs host
// ever sits on a deeper apex.
async function warnWwwRedirect() {
  const { hostname } = new URL(docsUrl);
  if (hostname.split('.').length !== 2) return;
  try {
    const res = await get('/x', `https://www.${hostname}`);
    const location = res.headers.get('location');
    const ok = res.status === 301 && location === `https://${hostname}/x`;
    console.log(`[smoke] ${ok ? 'ok  ' : 'WARN'} www.${hostname} → 301 → ${hostname} — HTTP ${res.status} ${location ?? ''}`);
  } catch (err) {
    console.log(`[smoke] WARN www.${hostname} → 301 → ${hostname} — ${err.cause?.code ?? err.message}`);
  }
}

// Right after a deploy the containers are starting, and a new host has no certificate
// yet (Traefik serves its self-signed default until Let's Encrypt answers): retry the
// round until it passes or SMOKE_WAIT_SECONDS (default 180) run out, then report it.
async function smokeWithRetry() {
  const deadline =
    Date.now() + Number(process.env.SMOKE_WAIT_SECONDS ?? 180) * 1000;
  let results = await smoke();
  while (results.some(([, ok]) => !ok) && Date.now() < deadline) {
    console.log('[smoke] not ready yet, retrying in 10 s');
    await new Promise((resolve) => setTimeout(resolve, 10000));
    results = await smoke();
  }
  for (const [name, ok, detail] of results) check(name, ok, detail);
}

if (!smokeOnly) await reportDeployService();
await smokeWithRetry();
if (docsUrl) await warnWwwRedirect();
if (failures.length) {
  console.error(
    `deploy-report: ${failures.length} check(s) failed: ${failures.join('; ')}`,
  );
  process.exit(1);
}
console.log('deploy-report: all checks passed');
