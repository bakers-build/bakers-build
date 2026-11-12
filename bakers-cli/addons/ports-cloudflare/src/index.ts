// BB-681 Task 2 — Named Cloudflare as a `PortsTransport`. The connector
// (`cloudflared` daemon) is operator-managed: this package never starts or
// stops it, only reconciles DNS + ingress via the Cloudflare REST API.

import type { PortsTransport } from '@bakers-build/addon-ports/transport';
import type { CloudflareConfig, CloudflareDeps } from './cloudflare.js';
import { reconcileCloudflare } from './reconcile.js';

export type { CloudflareConfig, CloudflareDeps } from './cloudflare.js';
export { reconcileCloudflare } from './reconcile.js';

/** The `@bakers-build/addon-ports` entry's `with.transport.with` for this transport. */
export interface CloudflareSettings {
  readonly account_id: string;
  readonly tunnel_id: string;
  readonly zone_id: string;
  readonly zone: string;
  readonly api_token: string;
}

const REQUIRED_FIELDS = [
  'account_id',
  'tunnel_id',
  'zone_id',
  'zone',
  'api_token',
] as const;

function validateSettings(settings: unknown): CloudflareConfig {
  if (typeof settings !== 'object' || settings === null) {
    throw new Error(
      "the @bakers-build/addon-ports entry's with.transport.with for 'cloudflare' must be an object with account_id/tunnel_id/zone_id/zone/api_token",
    );
  }
  const obj = settings as Record<string, unknown>;
  const missing = REQUIRED_FIELDS.filter(
    (f) => typeof obj[f] !== 'string' || obj[f] === '',
  );
  if (missing.length > 0) {
    throw new Error(
      `the @bakers-build/addon-ports entry's with.transport.with for 'cloudflare' is missing: ${missing.join(', ')}`,
    );
  }
  return {
    accountId: obj.account_id as string,
    tunnelId: obj.tunnel_id as string,
    zoneId: obj.zone_id as string,
    zone: obj.zone as string,
    apiToken: obj.api_token as string,
  };
}

/** Real `fetch` — the only seam into the actual network, injected into
 *  `reconcileCloudflare`/`cloudflare.ts`'s calls, never used directly by the
 *  generic ports layer. */
const nodeCloudflareDeps: CloudflareDeps = {
  fetch: async (url, init) => {
    const res = await fetch(url, init as RequestInit);
    return { ok: res.ok, status: res.status, json: () => res.json() };
  },
  timeoutMs: 10_000,
};

/** Allowlisted provider state for this transport: only a DNS record id. */
function validateData(data: unknown): void {
  if (typeof data !== 'object' || data === null) {
    throw new Error('cloudflare transport data must be an object');
  }
  const obj = data as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.some((k) => k !== 'dnsRecordId')) {
    throw new Error(
      `cloudflare transport data has unknown field(s): ${keys.filter((k) => k !== 'dnsRecordId').join(', ')}`,
    );
  }
  if (obj.dnsRecordId !== undefined && typeof obj.dnsRecordId !== 'string') {
    throw new Error('cloudflare transport data.dnsRecordId must be a string');
  }
}

/**
 * Default export factory consumed by `@bakers-build/addon-ports`'s
 * `loadPortsTransport`. `identity` deliberately excludes `api_token` — a
 * rotated token with the same account/tunnel/zone is NOT an identity change.
 */
export default async function createTransport(
  settings: unknown,
  _context: { readonly home: string },
): Promise<PortsTransport> {
  const cfg: CloudflareConfig = validateSettings(settings);
  const deps = nodeCloudflareDeps;
  return {
    id: 'cloudflare',
    identity: `${cfg.accountId}/${cfg.tunnelId}/${cfg.zoneId}`,
    zone: cfg.zone,
    validateData,
    reconcile: (records, { checkpoint }) =>
      reconcileCloudflare(records, cfg, deps, { checkpoint }),
  };
}
