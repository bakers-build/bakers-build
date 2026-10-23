#!/usr/bin/env node
// Deploy report for the CI deploy job: print the server's own `deploy` service output and
// exit state (through the Komodo read API), then smoke-check the live host. Any failure
// exits non-zero, naming the failed check, so a broken deploy is never green.
//
//   node scripts/deploy/deploy-report.mjs <stack> <base-url>   # CI: log + exit state + smoke
//   node scripts/deploy/deploy-report.mjs --smoke-only <base-url>
//
// Env (full mode): KOMODO_URL, KOMODO_API_KEY, KOMODO_API_SECRET. Node >= 18 (global fetch).

const args = process.argv.slice(2);
const smokeOnly = args[0] === '--smoke-only';
const [stack, baseUrl] = smokeOnly ? [null, args[1]] : args;
if (!baseUrl || (!smokeOnly && !stack)) {
  console.error(
    'usage: deploy-report.mjs <stack> <base-url> | --smoke-only <base-url>',
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

async function get(path) {
  return fetch(new URL(path, baseUrl), {
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
    // The MCP service demands a bearer; Drupal would answer with its own X-Generator.
    [
      '/mcp answers from the MCP service',
      '/mcp',
      (r) =>
        r.status === 401 &&
        /resource_metadata=/.test(r.headers.get('www-authenticate') ?? '') &&
        !/Drupal/.test(r.headers.get('x-generator') ?? ''),
    ],
  ];
  for (const [name, path, ok] of probes) {
    try {
      const res = await get(path);
      check(name, ok(res), `HTTP ${res.status}`);
    } catch (err) {
      check(name, false, err.cause?.code ?? err.cause?.message ?? err.message);
    }
  }
}

if (!smokeOnly) await reportDeployService();
await smoke();
if (failures.length) {
  console.error(
    `deploy-report: ${failures.length} check(s) failed: ${failures.join('; ')}`,
  );
  process.exit(1);
}
console.log('deploy-report: all checks passed');
