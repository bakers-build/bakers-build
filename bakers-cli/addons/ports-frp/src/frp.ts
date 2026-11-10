// BB-681 Task 3 — frp (frpc) as a `PortsTransport`. The frpc PROCESS is
// operator-managed (same stance as Cloudflare's `cloudflared`): this package
// never starts/stops it, only (a) validates the operator's own frpc config
// is shaped the way this addon needs, (b) writes the ONE file it owns
// (`<home>/frp/routes.json`, the config's sole `includes` entry) and (c)
// drives the local admin API to reload + confirm.

import type { TunnelDesiredRecord } from '@bakers-build/addon-ports/transport';

/** The validated `with.transport.with` of this transport (internal names). */
export interface FrpSettings {
  readonly zone: string;
  /** Absolute path to the operator-owned frpc client config (JSON). This
   *  addon only READS and validates it — it never writes to it. */
  readonly clientConfigPath: string;
  readonly adminPort: number;
  readonly adminUser: string;
  readonly adminPassword: string;
}

export class FrpConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FrpConfigError';
  }
}

const RENAMED: Record<string, string> = {
  clientConfigPath: 'client_config_path',
  adminPort: 'admin_port',
  adminUser: 'admin_user',
  adminPassword: 'admin_password',
};

/** Reads the snake_case `with` keys into the internal {@link FrpSettings}. */
export function validateSettings(settings: unknown): FrpSettings {
  if (typeof settings !== 'object' || settings === null) {
    throw new FrpConfigError(
      "the @bakers-build/addon-ports entry's with.transport.with for 'frp' must be an object with zone/client_config_path/admin_port/admin_user/admin_password",
    );
  }
  const obj = settings as Record<string, unknown>;
  for (const old of Object.keys(RENAMED))
    if (old in obj)
      throw new FrpConfigError(`${old} was renamed: use ${RENAMED[old]}`);
  if (typeof obj.zone !== 'string' || obj.zone === '') {
    throw new FrpConfigError(
      "the @bakers-build/addon-ports entry's with.transport.with for 'frp' is missing: zone",
    );
  }
  if (
    typeof obj.client_config_path !== 'string' ||
    !obj.client_config_path.startsWith('/')
  ) {
    throw new FrpConfigError(
      "the @bakers-build/addon-ports entry's with.transport.with for 'frp' requires an absolute 'client_config_path'",
    );
  }
  if (typeof obj.admin_port !== 'number' || !Number.isInteger(obj.admin_port)) {
    throw new FrpConfigError(
      "the @bakers-build/addon-ports entry's with.transport.with for 'frp' requires an integer 'admin_port'",
    );
  }
  if (typeof obj.admin_user !== 'string' || obj.admin_user === '') {
    throw new FrpConfigError(
      "the @bakers-build/addon-ports entry's with.transport.with for 'frp' is missing: admin_user",
    );
  }
  if (typeof obj.admin_password !== 'string' || obj.admin_password === '') {
    throw new FrpConfigError(
      "the @bakers-build/addon-ports entry's with.transport.with for 'frp' is missing: admin_password",
    );
  }
  return {
    zone: obj.zone,
    clientConfigPath: obj.client_config_path,
    adminPort: obj.admin_port,
    adminUser: obj.admin_user,
    adminPassword: obj.admin_password,
  };
}

/** The slice of the operator's frpc JSON config this addon actually reads.
 *  ponytail: this is a PLAUSIBLE frpc 0.68.0 config shape built from the
 *  public docs' field names (`serverAddr`/`serverPort`/`auth`/`user`/
 *  `webServer`/`transport.tls`/`includes`) — not a verified real capture.
 *  Upgrade path: swap in the real frpc config schema/types if frp ships
 *  one, or once an operator confirms the exact shape in use. */
export interface FrpClientConfig {
  readonly serverAddr?: unknown;
  readonly serverPort?: unknown;
  readonly user?: unknown;
  readonly auth?: { readonly method?: unknown } | undefined;
  readonly webServer?: { readonly addr?: unknown } | undefined;
  readonly transport?:
    | {
        readonly tls?:
          | { readonly enable?: unknown; readonly trustedCaFile?: unknown }
          | undefined;
      }
    | undefined;
  readonly includes?: readonly unknown[] | undefined;
  readonly proxies?: unknown;
  readonly visitors?: unknown;
  readonly store?: unknown;
}

/** The nonsecret canonical client identity: server + user + zone + the
 *  config path itself (NOT its contents — token rotation inside the same
 *  file must not change this, per Task 2's identity-change-safety rule). */
export interface FrpClientIdentity {
  readonly server: string;
  readonly user: string;
}

/**
 * Validate the operator's frpc config strictly (spec): admin API loopback
 * only, a dedicated user/client identity, server address/port, auth
 * present, EXPLICIT server-TLS verification (frp's default encryption alone
 * is not identity verification), and EXACTLY ONE include — the absolute
 * routes file path this addon owns. Any other shape — inline proxies,
 * visitors, a store, extra/missing includes — is a hard, pre-mutation error.
 */
export function validateClientConfig(
  config: unknown,
  routesPath: string,
): FrpClientIdentity {
  if (typeof config !== 'object' || config === null) {
    throw new FrpConfigError('frpc client config must be a JSON object');
  }
  const cfg = config as FrpClientConfig;
  if (cfg.proxies !== undefined) {
    throw new FrpConfigError(
      'frpc client config must not declare inline proxies — this addon owns routes.json exclusively',
    );
  }
  if (cfg.visitors !== undefined) {
    throw new FrpConfigError(
      'frpc client config must not declare inline visitors',
    );
  }
  if (cfg.store !== undefined) {
    throw new FrpConfigError('frpc client config must not declare a store');
  }
  if (typeof cfg.serverAddr !== 'string' || cfg.serverAddr === '') {
    throw new FrpConfigError('frpc client config is missing serverAddr');
  }
  if (typeof cfg.serverPort !== 'number') {
    throw new FrpConfigError('frpc client config is missing serverPort');
  }
  if (typeof cfg.user !== 'string' || cfg.user === '') {
    throw new FrpConfigError(
      'frpc client config must declare a dedicated user/client identity',
    );
  }
  if (typeof cfg.auth?.method !== 'string' || cfg.auth.method === '') {
    throw new FrpConfigError('frpc client config must declare authentication');
  }
  if (cfg.webServer?.addr !== '127.0.0.1') {
    throw new FrpConfigError(
      'frpc admin service (webServer.addr) must bind 127.0.0.1 (loopback only)',
    );
  }
  const tls = cfg.transport?.tls;
  if (
    tls?.enable !== true ||
    typeof tls.trustedCaFile !== 'string' ||
    tls.trustedCaFile === ''
  ) {
    throw new FrpConfigError(
      'frpc client config must explicitly require TLS verification of the server (transport.tls.enable=true with a trustedCaFile) — encryption alone is not identity verification',
    );
  }
  const includes = cfg.includes ?? [];
  if (includes.length !== 1 || includes[0] !== routesPath) {
    throw new FrpConfigError(
      `frpc client config must have EXACTLY ONE include, the routes file this addon owns (${routesPath})`,
    );
  }
  return { server: `${cfg.serverAddr}:${cfg.serverPort}`, user: cfg.user };
}

/** frp client-plugin proxy shape this addon writes into routes.json — the
 *  complete desired proxy list, no secrets. */
export interface FrpProxy {
  readonly name: string;
  readonly type: 'http';
  readonly customDomains: readonly [string];
  readonly localIP?: string;
  readonly localPort?: number;
  readonly hostHeaderRewrite?: string;
  readonly requestHeaders?: {
    readonly set: Readonly<Record<string, string>>;
  };
  readonly plugin?: {
    readonly type: 'http2https';
    readonly localAddr: string;
    readonly hostHeaderRewrite?: string;
  };
}

export class FrpUnverifiedHttpsError extends FrpConfigError {
  constructor(hostname: string | undefined) {
    super(
      `${hostname ?? '(unknown route)'}: requests verified HTTPS origin proxying, but frp 0.68.0's http2https plugin unconditionally skips origin certificate verification — set insecureTls: true to accept that, or serve plain HTTP`,
    );
    this.name = 'FrpUnverifiedHttpsError';
  }
}

/** The record's `direct` container origin as host + port, or `undefined`
 *  when it has none. `direct` comes from persisted state, so anything but a
 *  plain `http:` URL with a host is rejected rather than dialled. */
export function directOrigin(
  record: TunnelDesiredRecord,
): { readonly host: string; readonly port: number } | undefined {
  if (record.direct === undefined) return undefined;
  let url: URL | undefined;
  try {
    url = new URL(record.direct);
  } catch {
    url = undefined;
  }
  if (url?.protocol !== 'http:' || url.hostname === '') {
    throw new FrpConfigError(
      `${record.hostname ?? '(unknown route)'}: direct origin must be a plain http://<host>:<port> URL`,
    );
  }
  return { host: url.hostname, port: Number(url.port || '80') };
}

/**
 * Pure translation: one `TunnelDesiredRecord` -> one frp proxy. Throws
 * `FrpUnverifiedHttpsError` for an HTTPS origin whose verification was
 * requested (insecureTls false/omitted) — never silently downgraded.
 */
export function toFrpProxy(record: TunnelDesiredRecord): FrpProxy {
  const name = `${record.ticket}-${record.key}`;
  const hostname = record.hostname;
  // A direct container origin skips the router entirely: no Host rewrite, so
  // the app sees the public Host; frps terminates TLS, hence the forced proto.
  const direct = directOrigin(record);
  if (direct) {
    return {
      name,
      type: 'http',
      customDomains: [hostname as string],
      localIP: direct.host,
      localPort: direct.port,
      requestHeaders: { set: { 'X-Forwarded-Proto': 'https' } },
    };
  }
  const url = new URL(record.service);
  if (url.protocol === 'https:') {
    if (record.insecureTls !== true) {
      throw new FrpUnverifiedHttpsError(hostname);
    }
    const port = url.port || '443';
    return {
      name,
      type: 'http',
      customDomains: [hostname as string],
      plugin: {
        type: 'http2https',
        localAddr: `${url.hostname}:${port}`,
        ...(record.hostHeader ? { hostHeaderRewrite: record.hostHeader } : {}),
      },
    };
  }
  const port = Number(url.port || '80');
  return {
    name,
    type: 'http',
    customDomains: [hostname as string],
    localIP: url.hostname,
    localPort: port,
    ...(record.hostHeader ? { hostHeaderRewrite: record.hostHeader } : {}),
  };
}
