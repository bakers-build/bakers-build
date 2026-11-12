import type { AuthAdapter, HttpClient, JsonApiClient } from 'dropsh/plugin';
import { shellQuote } from '../core/shell.js';
import type { BbCommandHost } from './commands.js';
import { type ConfigReport, finalizeConfigReport } from './config-report.js';
import { type BbConnectionConfig, loadBbConfig } from './load-bakers-config.js';
import { resolveCliVersion } from './version-check.js';

/** The server's client-version contract: claims require it, other errors hint at it. */
export function withBakersClientHeader(http: HttpClient): HttpClient {
  const value = `bakers/${resolveCliVersion()}`;
  return {
    send: (request) =>
      http.send({
        ...request,
        headers: { ...request.headers, 'X-Bakers-Client': value },
      }),
  };
}

/** Shared normal dropsh authentication, context and request-hook composition. */
export async function createBbConnectionContext(
  connection: Pick<BbConnectionConfig, 'site' | 'plugins'>,
  options: {
    stateDir?: string;
    http?: HttpClient;
    cwd?: string;
    profile?: string;
    auth?: AuthAdapter;
    signal?: AbortSignal;
    /** Decorates the transport, e.g. to filter responses for agent reads. */
    wrapHttp?: (http: HttpClient) => HttpClient;
  } = {},
): Promise<import('dropsh').CommandContext> {
  const [
    { resolveAuth },
    { createHttpClient, createJsonApiClient, PluginError, AuthError },
  ] = await Promise.all([import('dropsh'), import('dropsh/plugin')]);
  // BB-607: a write whose response is lost may already have applied, and
  // dropsh's client retries every request after a network failure; a
  // re-sent POST created the same entity up to four times. Reads keep the
  // retries; a write is sent once and its failure stays uncertain.
  const signal = options.signal;
  const cancellable = signal
    ? {
        // dropsh retries aborted requests; a cancellable operation must stop immediately.
        maxRetries: 0,
        fetch: ((input, init) => {
          signal.throwIfAborted();
          return fetch(input, {
            ...init,
            signal: AbortSignal.any([
              signal,
              ...(init?.signal ? [init.signal] : []),
            ]),
          });
        }) as typeof fetch,
      }
    : {};
  const reads = createHttpClient(cancellable);
  const writes = createHttpClient({ ...cancellable, maxRetries: 0 });
  const transport: HttpClient = options.http ?? {
    send: (request) =>
      (request.method === 'GET' ? reads : writes).send(request),
  };
  const http = withBakersClientHeader(
    options.wrapHttp ? options.wrapHttp(transport) : transport,
  );
  const auth =
    options.auth ??
    (await resolveAuth({
      baseUrl: connection.site.base_url,
      plugins: connection.plugins,
      http,
      now: Date.now,
      ...(options.stateDir ? { stateDir: options.stateDir } : {}),
      ...(options.profile ? { profile: options.profile } : {}),
    }).catch((error: unknown) => {
      if (error instanceof AuthError) {
        error.message = error.message.replace(
          "Run 'dropsh auth login",
          "Run 'bakers auth login",
        );
      }
      throw error;
    }));
  const context = {
    http,
    auth,
    baseUrl: connection.site.base_url,
    jsonapiPrefix: connection.site.jsonapi_prefix,
  };
  const client = createJsonApiClient({
    baseUrl: context.baseUrl,
    prefix: context.jsonapiPrefix,
    http,
    auth,
    alterRequest: async (request, operation, entityType, bundle) => {
      let current = request;
      for (const plugin of connection.plugins) {
        if (!plugin.alterRequest) continue;
        try {
          current = await plugin.alterRequest(current, {
            ...context,
            operation,
            ...(entityType ? { entityType } : {}),
            ...(bundle ? { bundle } : {}),
          });
          if (!current)
            throw new Error('alterRequest must return an HttpRequest');
        } catch (cause) {
          throw new PluginError(plugin.id, 'alterRequest', cause);
        }
      }
      return current;
    },
  });
  return {
    ...context,
    client,
    plugins: connection.plugins,
    cwd: options.cwd ?? process.cwd(),
  };
}
export async function createBbConnectionClient(
  connection: Pick<BbConnectionConfig, 'site' | 'plugins'>,
  options: {
    stateDir?: string;
    http?: HttpClient;
    auth?: AuthAdapter;
    signal?: AbortSignal;
  } = {},
): Promise<JsonApiClient> {
  return (await createBbConnectionContext(connection, options)).client;
}

/**
 * Whether a session is already stored for the selected connection.
 * Purely a local read of the auth state dir — no token is minted and no
 * request is sent, so a caller can afford it on a path that is deliberately
 * not going online.
 *
 * It exists so a deferred online stage can say which of two situations it is
 * in: nobody has signed in yet, or someone has and the check simply was not
 * run. A stored session counts even when its access token has expired: the
 * device-code and authcode grants renew it from the stored refresh token on
 * the next request, and the `--online` check the caller points at is what
 * tells a renewable session from a dead one. An unreadable connection counts
 * as none; the inventory findings already describe that file.
 */
export async function hasStoredBbSession(
  host: BbCommandHost,
  options: { cwd?: string; explicit?: string; stateDir?: string } = {},
): Promise<boolean> {
  try {
    const [{ authStatus }, connection] = await Promise.all([
      import('dropsh'),
      loadBbConfig(host, {
        ...(options.cwd ? { cwd: options.cwd } : {}),
        ...(options.explicit ? { explicit: options.explicit } : {}),
      }),
    ]);
    const status = await authStatus({
      baseUrl: connection.site.base_url,
      plugins: connection.plugins,
      ...(options.stateDir ? { stateDir: options.stateDir } : {}),
    });
    return status.loggedIn;
  } catch {
    return false;
  }
}

export interface ConfigOnlineOptions {
  host: BbCommandHost;
  cwd?: string;
  stateDir?: string;
  /** Fresh client-credential init verifies without requiring a stored session. */
  ephemeralClientCredentials?: boolean;
}

/** Read each selected connection explicitly so a project cannot hide a broken global default. */
export async function verifyConfigConnections(
  report: ConfigReport,
  options: ConfigOnlineOptions,
): Promise<ConfigReport> {
  if (report.resolved_scopes.every((scope) => scope === 'machine')) {
    report.verification.online = {
      status: 'not_applicable',
      reason:
        'Machine scope is validated locally and makes no connection request.',
    };
    report.verification.readiness = 'not_applicable';
    return report;
  }
  const global = report.files.find((file) => file.kind === 'connection');
  const project = report.files.find(
    (file) => file.kind === 'project-connection' && file.state !== 'absent',
  );
  const selected = new Map<string, NonNullable<typeof global>>();
  if (report.resolved_scopes.includes('connection') && global)
    selected.set(global.path, global);
  if (report.resolved_scopes.includes('project')) {
    const effective = project ?? global;
    if (effective) selected.set(effective.path, effective);
  }
  let failures = 0;
  const connections: NonNullable<
    ConfigReport['verification']['online']['connections']
  > = [];
  for (const file of selected.values()) {
    let stage: 'load' | 'auth' = 'load';
    try {
      const connection = await loadBbConfig(options.host, {
        ...(options.cwd ? { cwd: options.cwd } : {}),
        explicit: file.path,
      });
      stage = 'auth';
      let http: HttpClient | undefined;
      let auth: AuthAdapter | undefined;
      if (options.ephemeralClientCredentials) {
        const { createHttpClient } = await import('dropsh/plugin');
        http = withBakersClientHeader(createHttpClient());
        const provider = connection.plugins
          .map((plugin) => plugin.authProvider)
          .find((candidate) => candidate?.id === 'bakers');
        if (!provider)
          throw new Error('Generated connection has no bakers auth provider.');
        const session = await provider.login({
          baseUrl: connection.site.base_url,
          http,
          now: Date.now,
          stdout: () => {},
          prompt: async () => {
            throw new Error('Generated client credentials require no prompt.');
          },
          openBrowser: async () => {
            throw new Error('Generated client credentials require no browser.');
          },
        });
        auth = provider.createAdapter(session, {
          http,
          now: Date.now,
          save: async () => {},
        });
      }
      const client = await createBbConnectionClient(connection, {
        ...(options.stateDir ? { stateDir: options.stateDir } : {}),
        ...(http ? { http } : {}),
        ...(auth ? { auth } : {}),
      });
      // BB-495: `workspace_id` is optional, so online verification can no
      // longer prove auth by reading a configured workspace resource — that
      // requires one to be set, and dropsh no longer needs one. `me()`
      // resolves the authenticated identity independent of any workspace, so
      // it exercises the exact same auth path with no such dependency.
      await client.me();
      connections.push({ path: file.path, status: 'passed' });
    } catch (error) {
      failures++;
      connections.push({ path: file.path, status: 'failed' });
      const status =
        typeof error === 'object' && error !== null && 'status' in error
          ? error.status
          : undefined;
      const authFailure = stage === 'auth' || status === 401;
      const recheck = `bakers config check --scope ${file.layer === 'project' ? 'project' : 'connection'}${file.layer === 'project' && report.roots.project ? ` --path ${shellQuote(report.roots.project)}` : ''} --config ${shellQuote(global?.path ?? file.path)} --online`;
      report.findings.push({
        code: authFailure ? 'authentication_failure' : 'invalid_value',
        severity: 'error',
        stage: 'online',
        path: file.path,
        key: stage === 'auth' ? 'plugins' : null,
        expected: authFailure
          ? 'The selected configured identity must authenticate.'
          : 'The selected connection and plugins must load successfully.',
        observed: typeof status === 'number' ? status : '[redacted]',
        owner: file.layer,
        related: [],
        statically_determined: false,
        remediation: authFailure
          ? `Check credentials in ${shellQuote(file.path)}; run bakers auth login --config ${shellQuote(file.path)}, then ${recheck}.`
          : `Inspect ${shellQuote(file.path)}; run ${recheck}.`,
        recheck,
      });
    }
  }
  finalizeConfigReport(report);
  // Keep the static finding truthful while recording what loading/auth/read
  // established. Computed host or engine values remain independently incomplete.
  if (
    !failures &&
    selected.size &&
    report.result === 'incomplete' &&
    report.findings
      .filter(
        (finding) =>
          finding.code === 'unknown_value' ||
          finding.code === 'unsupported_source_shape',
      )
      .every(
        (finding) =>
          finding.code === 'unknown_value' && selected.has(finding.path),
      )
  )
    report.result = 'ok';
  report.verification.online = {
    status: failures || !selected.size ? 'failed' : 'passed',
    reason: failures
      ? `Failed to verify ${failures} of ${selected.size} selected connections. Prepared configuration files remain in place; setup is incomplete.`
      : selected.size
        ? `Authenticated ${selected.size} distinct connection${selected.size === 1 ? '' : 's'}.`
        : 'No selected connection is available to verify.',
  };
  report.verification.readiness =
    !failures && selected.size && report.result === 'ok'
      ? 'ready'
      : 'unverified';
  report.verification.online.connections = connections;
  return report;
}
