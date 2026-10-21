// BB-676 Task 3, moved to its own package by BB-681 Task 2 — the
// Cloudflare REST calls a reconciliation needs: upload the tunnel's ingress
// configuration and own the proxied CNAME per hostname. See
// https://developers.cloudflare.com/api/resources/zero_trust/subresources/tunnels/subresources/cloudflared/subresources/configurations/
// and https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel-api/
// for the API shapes this wraps; locking/ownership/retry semantics are this
// ticket's own decisions, not the API's.

export interface CloudflareConfig {
  readonly accountId: string;
  readonly tunnelId: string;
  readonly zoneId: string;
  /** The bare zone hostname (e.g. `preview.example`) — carried here so
   *  `index.ts` can surface it as `PortsTransport.zone` for hostname
   *  construction; `cloudflare.ts`'s own API calls use `zoneId`, not this. */
  readonly zone: string;
  readonly apiToken: string;
}

export interface CfOriginRequest {
  readonly httpHostHeader?: string;
  readonly noTLSVerify?: boolean;
}

export interface CfIngressRule {
  readonly hostname?: string;
  readonly service: string;
  readonly originRequest?: CfOriginRequest;
}

export interface CfFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

/** The HTTP seam, injected — a test fakes it, nothing here calls real `fetch`. */
export interface CloudflareDeps {
  fetch(
    url: string,
    init: {
      readonly method: string;
      readonly headers: Readonly<Record<string, string>>;
      readonly body?: string;
      readonly signal?: AbortSignal;
    },
  ): Promise<CfFetchResponse>;
  readonly timeoutMs: number;
}

export class CloudflareApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CloudflareApiError';
  }
}

/** Replace the token with a fixed marker wherever it would otherwise leak
 *  into a thrown message, a log line or a CLI argument. */
function redact(token: string, message: string): string {
  return token ? message.split(token).join('[REDACTED]') : message;
}

interface CfEnvelope {
  readonly success?: boolean;
  readonly result?: unknown;
  readonly errors?: readonly { readonly message: string }[];
}

async function call(
  cfg: CloudflareConfig,
  deps: CloudflareDeps,
  path: string,
  init: { readonly method: string; readonly body?: unknown },
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs);
  try {
    let res: CfFetchResponse;
    try {
      res = await deps.fetch(`https://api.cloudflare.com/client/v4${path}`, {
        method: init.method,
        headers: {
          authorization: `Bearer ${cfg.apiToken}`,
          'content-type': 'application/json',
        },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        signal: controller.signal,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new CloudflareApiError(
        redact(cfg.apiToken, `${init.method} ${path} failed: ${msg}`),
      );
    }
    const body = (await res.json().catch(() => ({}))) as CfEnvelope;
    if (!res.ok || body.success === false) {
      const detail =
        (body.errors ?? []).map((e) => e.message).join('; ') ||
        `HTTP ${res.status}`;
      throw new CloudflareApiError(
        redact(cfg.apiToken, `${init.method} ${path} failed: ${detail}`),
      );
    }
    return body.result;
  } finally {
    clearTimeout(timer);
  }
}

/** The tunnel's currently uploaded ingress — read before replacing it, so an
 *  unexpected unmanaged rule set can block the replace rather than vanish. */
export async function getIngressConfig(
  cfg: CloudflareConfig,
  deps: CloudflareDeps,
): Promise<{ readonly ingress: readonly CfIngressRule[] }> {
  const result = await call(
    cfg,
    deps,
    `/accounts/${cfg.accountId}/cfd_tunnel/${cfg.tunnelId}/configurations`,
    { method: 'GET' },
  );
  const config = (result as { config?: { ingress?: CfIngressRule[] } } | null)
    ?.config;
  return { ingress: config?.ingress ?? [] };
}

/** Replace the WHOLE ingress list — Cloudflare's configuration API has no
 *  partial update, so every call uploads the complete desired set. */
export async function putIngressConfig(
  cfg: CloudflareConfig,
  ingress: readonly CfIngressRule[],
  deps: CloudflareDeps,
): Promise<void> {
  await call(
    cfg,
    deps,
    `/accounts/${cfg.accountId}/cfd_tunnel/${cfg.tunnelId}/configurations`,
    { method: 'PUT', body: { config: { ingress } } },
  );
}

export interface CfDnsRecord {
  readonly id: string;
  readonly content: string;
}

/** The exact-name CNAME, if any — used both to detect a foreign-owned
 *  conflict and to adopt a record this tunnel already created. */
export async function findDnsRecord(
  cfg: CloudflareConfig,
  hostname: string,
  deps: CloudflareDeps,
): Promise<CfDnsRecord | null> {
  const result = await call(
    cfg,
    deps,
    `/zones/${cfg.zoneId}/dns_records?type=CNAME&name=${encodeURIComponent(hostname)}`,
    { method: 'GET' },
  );
  const records = (result as CfDnsRecord[] | null) ?? [];
  return records[0] ?? null;
}

/** This tunnel's own target for a proxied CNAME — the only content a record
 *  this reconciliation may delete is allowed to carry (ownership check). */
export function tunnelCnameTarget(cfg: CloudflareConfig): string {
  return `${cfg.tunnelId}.cfargotunnel.com`;
}

export async function createDnsRecord(
  cfg: CloudflareConfig,
  hostname: string,
  deps: CloudflareDeps,
): Promise<CfDnsRecord> {
  const result = await call(cfg, deps, `/zones/${cfg.zoneId}/dns_records`, {
    method: 'POST',
    body: {
      type: 'CNAME',
      name: hostname,
      content: tunnelCnameTarget(cfg),
      proxied: true,
    },
  });
  return result as CfDnsRecord;
}

export async function deleteDnsRecord(
  cfg: CloudflareConfig,
  recordId: string,
  deps: CloudflareDeps,
): Promise<void> {
  await call(cfg, deps, `/zones/${cfg.zoneId}/dns_records/${recordId}`, {
    method: 'DELETE',
  });
}
