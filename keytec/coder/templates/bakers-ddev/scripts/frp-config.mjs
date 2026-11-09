#!/usr/bin/env node
// Turns the FRP enrollment string in BOX_FRP_ENROLLMENT into frpc's client config (README › Previews):
//   bkfrp1.<base64url JSON {server, port, zone, user, token}>
// Writes ~/.config/frp/frpc.json (0600) in the shape @bakers-build/addon-ports-frp accepts, an admin
// password once (~/.config/frp/admin-password, 0600) and an empty ~/.bakers/frp/routes.json, then
// prints the zone. A malformed string writes nothing and exits 1. The token never reaches a log.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CA_BUNDLE = '/etc/ssl/certs/ca-certificates.crt';
const ADMIN_PORT = 7400;

function parse(value) {
  const [prefix, payload, ...rest] = (value ?? '').split('.');
  if (prefix !== 'bkfrp1' || !payload || rest.length || !/^[A-Za-z0-9_-]+$/.test(payload)) return null;
  let e;
  try {
    e = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const text = (v) => typeof v === 'string' && /^[A-Za-z0-9._-]+$/.test(v);
  const ok = e && text(e.server) && Number.isInteger(e.port) && e.port > 0 && e.port < 65536 &&
    text(e.zone) && text(e.user) && typeof e.token === 'string' && e.token !== '';
  return ok ? e : null;
}

function writePrivate(path, content) {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, content, { mode: 0o600 });
  renameSync(tmp, path);
}

const e = parse(process.env.BOX_FRP_ENROLLMENT);
if (!e) {
  console.error('frp: enrollment malformed (expected bkfrp1.<base64url JSON with server, port, zone, user, token>); nothing written');
  process.exit(1);
}
const dir = join(homedir(), '.config', 'frp');
const routes = join(process.env.BB_HOME || join(homedir(), '.bakers'), 'frp', 'routes.json');
mkdirSync(dir, { recursive: true, mode: 0o700 });
mkdirSync(join(routes, '..'), { recursive: true, mode: 0o700 });
const passwordFile = join(dir, 'admin-password');
if (!existsSync(passwordFile)) writePrivate(passwordFile, randomBytes(24).toString('base64url'));
const password = readFileSync(passwordFile, 'utf8').trim();
writePrivate(
  join(dir, 'frpc.json'),
  `${JSON.stringify(
    {
      serverAddr: e.server,
      serverPort: e.port,
      user: e.user,
      auth: { method: 'token', token: e.token },
      webServer: { addr: '127.0.0.1', port: ADMIN_PORT, user: 'admin', password },
      transport: { tls: { enable: true, trustedCaFile: CA_BUNDLE } },
      includes: [routes],
    },
    null,
    2,
  )}\n`,
);
// What addon-ports-frp treats as absent, so it takes the file over on its first route.
if (!existsSync(routes)) writePrivate(routes, '{"proxies":[]}');
console.log(e.zone);
