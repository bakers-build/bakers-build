// BB-681 Task 3 — frp as a `PortsTransport`, wired to real Node I/O. The
// factory reads and strictly validates the operator's frpc config BEFORE
// returning a transport (spec: reject before any mutation), then hands
// `reconcileFrp` real fs/fetch/clock/delay seams.

import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import type { PortsTransport } from '@bakers-build/addon-ports/transport';
import {
  type FrpSettings,
  validateClientConfig,
  validateSettings,
} from './frp.js';
import {
  type FrpDeps,
  type FrpReconcileConfig,
  reconcileFrp,
} from './reconcile.js';

export type { FrpSettings } from './frp.js';
export { FrpConfigError, FrpUnverifiedHttpsError, toFrpProxy } from './frp.js';
export type { FrpDeps, FrpReconcileConfig } from './reconcile.js';
export { reconcileFrp } from './reconcile.js';

const nodeFrpDeps: FrpDeps = {
  readFile: (path) => readFile(path, 'utf8'),
  writeFile: async (path, data, mode) => {
    await writeFile(path, data, { encoding: 'utf8', mode });
    await chmod(path, mode);
  },
  rename: (from, to) => rename(from, to),
  mkdir: async (path) => {
    await mkdir(path, { recursive: true });
  },
  fetch: async (url, init) => {
    const res = await fetch(url, init);
    return { ok: res.ok, status: res.status, json: () => res.json() };
  },
  now: () => Date.now(),
  delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  canConnect: (host, port, timeoutMs) =>
    new Promise((resolve) => {
      const socket = createConnection({ host, port, timeout: timeoutMs });
      const done = (reachable: boolean) => {
        socket.destroy();
        resolve(reachable);
      };
      socket.once('connect', () => done(true));
      socket.once('timeout', () => done(false));
      socket.once('error', () => done(false));
    }),
};

/** Allowlisted provider state for this transport: only the generation
 *  fingerprint `reconcileFrp` uses for crash-recovery/foreign-file checks. */
function validateData(data: unknown): void {
  if (typeof data !== 'object' || data === null) {
    throw new Error('frp transport data must be an object');
  }
  const obj = data as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.some((k) => k !== 'generation')) {
    throw new Error(
      `frp transport data has unknown field(s): ${keys.filter((k) => k !== 'generation').join(', ')}`,
    );
  }
  if (obj.generation !== undefined && typeof obj.generation !== 'string') {
    throw new Error('frp transport data.generation must be a string');
  }
}

export default async function createTransport(
  settings: unknown,
  context: { readonly home: string },
): Promise<PortsTransport> {
  const cfg: FrpSettings = validateSettings(settings);
  const routesPath = join(context.home, 'frp', 'routes.json');

  let rawConfig: unknown;
  try {
    rawConfig = JSON.parse(await nodeFrpDeps.readFile(cfg.clientConfigPath));
  } catch {
    // BB-681 review M5: a fixed message, never the raw fs/JSON.parse
    // error — that error can embed filesystem details (permissions, other
    // paths probed) this client has no business repeating into CLI/inbox
    // output. The configured path alone is enough for the operator to fix.
    throw new Error(
      `frp transport cannot read or parse clientConfigPath '${cfg.clientConfigPath}' as JSON`,
    );
  }
  const clientIdentity = validateClientConfig(rawConfig, routesPath);

  const reconcileCfg: FrpReconcileConfig = {
    routesPath,
    identity: `${cfg.clientConfigPath}/${clientIdentity.server}/${clientIdentity.user}/${cfg.zone}`,
    adminBase: `http://127.0.0.1:${cfg.adminPort}`,
    adminUser: cfg.adminUser,
    adminPassword: cfg.adminPassword,
  };

  return {
    id: 'frp',
    identity: reconcileCfg.identity,
    zone: cfg.zone,
    validateData,
    reconcile: (records, { checkpoint }) =>
      reconcileFrp(records, reconcileCfg, nodeFrpDeps, { checkpoint }),
  };
}
