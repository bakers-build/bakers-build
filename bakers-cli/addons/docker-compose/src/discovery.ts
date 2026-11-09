// BB-676 spec v2 — generic Docker Compose discovery, no knowledge of any one
// container runtime.
//
// Split out of `@bakers-build/addon-ports` (operator decision 2026-10-15: the
// ports addon must not fire runtime commands itself) so firing `docker` is not
// that package's job. This package knows nothing about `HTTP(S)_EXPOSE`,
// `VIRTUAL_HOST` or any other runtime convention — it reports containers, their
// labels/env/bound ports, and the confirmed in-container sockets + supervisor
// daemons, correlated by pid. Interpreting what those mean (a router mapping,
// a Drupal site, …) is a consumer's job.

/** The injected seam — only `run`, since this package never reads `/proc`
 *  itself (that is `addon-ports`' own host-listener discovery). `stderr` is
 *  optional and only consulted to split an exit-126 `supervisorctl` failure
 *  (BB-681 Task 1): "command not found" (missing executable — no diagnostic,
 *  same as exit 127) versus "permission denied" (a real failure, still
 *  diagnostic) — the general exec behavior is otherwise unchanged. */
export interface DockerComposeDeps {
  run(
    cmd: string,
    args: string[],
    cwd?: string,
  ): Promise<{
    stdout: string;
    ok: boolean;
    exitCode?: number;
    stderr?: string;
  }>;
}

/** Exit 126 is POSIX "found but not executable" OR (many shells/`docker
 *  exec`) "command not found" — both reuse 126 instead of 127 in practice.
 *  Only a stderr phrase that clearly says "permission denied" counts as the
 *  real failure; anything else (including no stderr at all) is treated like
 *  a missing binary, so an engine that returns 126 for an absent
 *  `supervisorctl` never blocks a no-claim reap. */
function isPermissionDenied126(stderr: string | undefined): boolean {
  if (!stderr) return false;
  return /permission denied/i.test(stderr);
}

export interface ComposeDiagnostic {
  readonly source: 'docker' | 'web-sockets' | 'supervisor';
  readonly message: string;
  /** D: which container this diagnostic is about, when it is about one in
   *  particular (a per-container probe failure) — absent for a whole-pass
   *  failure (`docker ps`/`docker inspect` itself failing) that genuinely
   *  blinds every container at once. A reap must only withhold a record
   *  whose OWN container produced unresolved evidence, not every record in
   *  the worktree just because one unrelated container had a probe gap. */
  readonly containerId?: string;
}

/** A confirmed-listening socket inside a container, with its supervisor
 *  daemon attached when the pid correlation below found one. */
export interface ComposeSocket {
  readonly containerPort: number;
  /** The bind address `ss`/`/proc/net/tcp` reported — `127.0.0.11` is
   *  Docker's own embedded DNS resolver stub inside every container's
   *  network namespace, never an operator-addressable service; a consumer
   *  (`listeningSibling`) excludes it when picking a
   *  diagnostic "what IS listening" candidate for a dead claim. */
  readonly address?: string;
  readonly pid?: number;
  readonly daemon?: string;
  readonly daemonStatus?: 'RUNNING' | 'STOPPED' | 'EXITED' | 'UNKNOWN';
}

/** A supervisor-managed daemon with no live socket to attach to (typically
 *  STOPPED/EXITED) — distinct from "exposed but nothing is listening". */
export interface ComposeUnattachedDaemon {
  readonly daemon: string;
  readonly status: 'RUNNING' | 'STOPPED' | 'EXITED' | 'UNKNOWN';
}

export interface ComposeContainer {
  readonly id: string;
  readonly running: boolean;
  readonly labels: Readonly<Record<string, string>>;
  readonly env: Readonly<Record<string, string>>;
  /** `NetworkSettings.Ports`' tcp entries, container port → bound host port. */
  readonly boundPorts: ReadonlyMap<number, number>;
  /** `NetworkSettings.Networks`, network name → non-empty `IPAddress`. */
  readonly networks: ReadonlyMap<string, string>;
  /** `false` when the in-container socket probe itself failed (e.g. no `ss`
   *  in a minimal image) — `sockets` is then NOT proof of "nothing is
   *  listening", only that nothing could be confirmed listening; a consumer
   *  must not read an empty `sockets` as "dead" when this is `false`. */
  readonly socketsProbed: boolean;
  readonly sockets: readonly ComposeSocket[];
  readonly unattachedDaemons: readonly ComposeUnattachedDaemon[];
}

export interface ComposeDiscovery {
  readonly containers: readonly ComposeContainer[];
  readonly diagnostics: readonly ComposeDiagnostic[];
}

/** `docker ps -a --format '{{.ID}}'` — one id per line. */
export function parseDockerPsIds(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

interface ContainerInspect {
  readonly id: string;
  readonly running: boolean;
  readonly labels: Readonly<Record<string, string>>;
  readonly env: Readonly<Record<string, string>>;
  readonly boundPorts: ReadonlyMap<number, number>;
  readonly networks: ReadonlyMap<string, string>;
}

/**
 * `docker inspect <ids…>` — a JSON array, one entry per container. Malformed
 * input (or an entry missing `Id`) is dropped rather than thrown, so one bad
 * record does not blank the whole batch.
 */
export function parseDockerInspect(text: string): ContainerInspect[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: ContainerInspect[] = [];
  for (const entry of parsed) {
    const e = entry as Record<string, unknown>;
    const id = e.Id;
    if (typeof id !== 'string') continue;
    const state = e.State as Record<string, unknown> | undefined;
    const config = e.Config as Record<string, unknown> | undefined;
    const labels = (config?.Labels as Record<string, string>) ?? {};
    const envList = Array.isArray(config?.Env) ? (config.Env as string[]) : [];
    const env: Record<string, string> = {};
    for (const line of envList) {
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      env[line.slice(0, eq)] = line.slice(eq + 1);
    }
    const boundPorts = new Map<number, number>();
    const networkSettings = e.NetworkSettings as
      | Record<string, unknown>
      | undefined;
    const portsMap = networkSettings?.Ports as
      | Record<string, Array<{ HostPort?: string }> | null>
      | undefined;
    for (const [key, bindings] of Object.entries(portsMap ?? {})) {
      const [portStr, proto] = key.split('/');
      if (proto !== 'tcp' || !bindings || bindings.length === 0) continue;
      const containerPort = Number(portStr);
      const hostPort = Number(bindings[0]?.HostPort);
      if (Number.isInteger(containerPort) && Number.isInteger(hostPort)) {
        boundPorts.set(containerPort, hostPort);
      }
    }
    const networks = new Map<string, string>();
    const networksMap = networkSettings?.Networks as
      | Record<string, { IPAddress?: unknown } | null>
      | undefined;
    for (const [name, network] of Object.entries(networksMap ?? {})) {
      const ip = network?.IPAddress;
      if (typeof ip === 'string' && ip !== '') networks.set(name, ip);
    }
    out.push({
      id,
      running: state?.Running === true,
      labels,
      env,
      boundPorts,
      networks,
    });
  }
  return out;
}

/** One listening socket `ss -ltnp` reported. `pid`/`command` are absent for a
 *  row with no process column (no permission to see the owner, or a root-
 *  owned listener an unprivileged `docker exec` cannot resolve) — still real
 *  listening evidence, just with an unknown owner. */
export interface SocketListener {
  readonly address: string;
  readonly port: number;
  readonly command?: string;
  readonly pid?: number;
}

/**
 * Parse `ss -ltnp` output into listeners.
 *
 * The line's shape is `LISTEN q q <addr>:<port> <peer> users:(("cmd",pid=N,fd=…))`.
 * The address may be `127.0.0.1`, `0.0.0.0`, `*`, or an IPv6 form in brackets, so
 * the port is read as the last `:`-separated field of the local-address column
 * and everything before it is the bind address. A row with no process column
 * (no permission, or a kernel socket) is KEPT — it is still listening
 * evidence, just with no pid to correlate a supervisor daemon against.
 */
export function parseSocketListeners(text: string): SocketListener[] {
  const listeners: SocketListener[] = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('LISTEN')) continue;
    const columns = line.trim().split(/\s+/);
    const local = columns[3] ?? '';
    const sep = local.lastIndexOf(':');
    if (sep === -1) continue;
    const port = Number(local.slice(sep + 1));
    if (!Number.isInteger(port)) continue;
    const address = local.slice(0, sep).replace(/^\[|\]$/g, '');
    const process = /\(\("([^"]+)",pid=(\d+)/.exec(line);
    listeners.push({
      address,
      port,
      ...(process
        ? { command: process[1] ?? '', pid: Number(process[2]) }
        : {}),
    });
  }
  return listeners;
}

/** C: fallback when `ss` is missing/fails entirely inside the container
 *  (exit 127, not "ran, found nothing") — images like phpMyAdmin/OpenSearch
 *  ship neither `ss` nor `netstat`. Parse `/proc/net/tcp`(6) directly: each
 *  data line's 2nd column is `local_address:port_hex`, the 4th column is
 *  connection state, `0A` hex = LISTEN. This reads the kernel's own listener
 *  table — strictly real listening evidence, unlike trusting a published
 *  host port binding (Docker binds a host port whether or not anything
 *  inside listens). */
/** `/proc/net/tcp`'s IPv4 address column is 8 hex chars, little-endian byte
 *  order — `0B00007F` is `127.0.0.11`, not `11.0.0.127`. A 32-char IPv6 form
 *  is returned as-is (comparisons against it are not needed here). */
function decodeProcNetAddress(hex: string): string {
  if (hex.length !== 8) return hex;
  const bytes = [0, 2, 4, 6].map((i) =>
    Number.parseInt(hex.slice(i, i + 2), 16),
  );
  return bytes.reverse().join('.');
}

export function parseProcNetTcp(text: string): SocketListener[] {
  const listeners: SocketListener[] = [];
  const lines = text.split('\n').slice(1); // header row
  for (const line of lines) {
    const cols = line.trim().split(/\s+/);
    const localAddress = cols[1];
    const state = cols[3];
    if (!localAddress || state !== '0A') continue;
    const sep = localAddress.lastIndexOf(':');
    if (sep === -1) continue;
    const port = Number.parseInt(localAddress.slice(sep + 1), 16);
    if (!Number.isInteger(port)) continue;
    listeners.push({
      address: decodeProcNetAddress(localAddress.slice(0, sep)),
      port,
    });
  }
  return listeners;
}

/** `ps -eo pid,ppid --no-headers` → child pid to parent pid, for walking a
 *  socket's process up to the supervisor-managed ancestor that owns it: a
 *  supervisor daemon's reported pid is its own forked process, not
 *  necessarily the child that actually binds the socket. */
export function parsePidParents(text: string): Map<number, number> {
  const out = new Map<number, number>();
  for (const line of text.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    if (!match) continue;
    out.set(Number(match[1]), Number(match[2]));
  }
  return out;
}

/** Is `ancestorPid` the supervisor pid, or an ancestor of it, up to a
 *  bounded depth? Protects against a cyclic/malformed parent map. */
function isAncestor(
  parents: ReadonlyMap<number, number>,
  pid: number,
  ancestorPid: number,
): boolean {
  let current: number | undefined = pid;
  for (let hop = 0; hop < 16 && current !== undefined; hop += 1) {
    if (current === ancestorPid) return true;
    current = parents.get(current);
  }
  return false;
}

interface SupervisorEntry {
  readonly daemon: string;
  readonly status: 'RUNNING' | 'STOPPED' | 'EXITED' | 'UNKNOWN';
  readonly pid?: number;
}

/** `supervisorctl status` — `group:name STATUS [pid N, uptime …]`. */
export function parseSupervisorStatus(text: string): SupervisorEntry[] {
  const out: SupervisorEntry[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    const match =
      /^(\S+)\s+(RUNNING|STOPPED|EXITED|STARTING|BACKOFF|FATAL)\b(.*)$/.exec(
        trimmed,
      );
    if (!match) continue;
    const status =
      match[2] === 'RUNNING' || match[2] === 'STOPPED' || match[2] === 'EXITED'
        ? match[2]
        : 'UNKNOWN';
    const pid = /pid (\d+)/.exec(match[3] ?? '');
    out.push({
      daemon: match[1] ?? '',
      status,
      ...(pid ? { pid: Number(pid[1]) } : {}),
    });
  }
  return out;
}

/**
 * Discover this worktree's Docker Compose containers: `docker ps -a` (label
 * filters supplied by the caller — `com.docker.compose.project.working_dir`
 * is always included, since that is the label Compose itself sets; a
 * caller passes `extraLabelFilters` to union its runtime's own worktree label,
 * without this package knowing what that label means), `docker inspect`, and one bounded per-running-container
 * `docker exec` (socket `ss -ltnp` + `supervisorctl status`, run concurrently
 * across containers, pid-correlated).
 */
export async function discoverCompose(
  worktree: string,
  deps: DockerComposeDeps,
  opts?: { readonly extraLabelFilters?: readonly string[] },
): Promise<ComposeDiscovery> {
  const diagnostics: ComposeDiagnostic[] = [];
  const labels = [
    'com.docker.compose.project.working_dir',
    ...(opts?.extraLabelFilters ?? []),
  ];
  const psResults = await Promise.all(
    labels.map((label) =>
      deps.run('docker', [
        'ps',
        '-a',
        '--filter',
        `label=${label}=${worktree}`,
        '--format',
        '{{.ID}}',
      ]),
    ),
  );
  if (psResults.every((r) => !r.ok)) {
    diagnostics.push({
      source: 'docker',
      message: '`docker ps` failed — container discovery is unknown, not empty',
    });
    return { containers: [], diagnostics };
  }
  const ids = [
    ...new Set(
      psResults.flatMap((r) => (r.ok ? parseDockerPsIds(r.stdout) : [])),
    ),
  ];
  if (ids.length === 0) return { containers: [], diagnostics };

  const inspect = await deps.run('docker', ['inspect', ...ids]);
  if (!inspect.ok) {
    diagnostics.push({ source: 'docker', message: '`docker inspect` failed' });
    return { containers: [], diagnostics };
  }
  const inspected = parseDockerInspect(inspect.stdout);

  const perContainer = await Promise.all(
    inspected.map(
      async (
        c,
      ): Promise<{
        container: ComposeContainer;
        diagnostics: ComposeDiagnostic[];
      }> => {
        const containerDiagnostics: ComposeDiagnostic[] = [];
        if (!c.running) {
          return {
            container: {
              ...c,
              socketsProbed: true,
              sockets: [],
              unattachedDaemons: [],
            },
            diagnostics: containerDiagnostics,
          };
        }

        const [socketsRes, pidTreeRes, supervisorRes] = await Promise.all([
          deps.run('docker', ['exec', c.id, 'ss', '-ltnp']),
          deps.run('docker', [
            'exec',
            c.id,
            'ps',
            '-eo',
            'pid,ppid',
            '--no-headers',
          ]),
          deps.run('docker', ['exec', c.id, 'supervisorctl', 'status']),
        ]);
        // B: `supervisorctl status` exits 3 (LSB NOT_RUNNING) whenever ANY
        // managed program is STOPPED/EXITED/FATAL — not just when the whole
        // call failed. Its stdout still lists every program's status in that
        // case, so parse it the same as exit 0; only a genuine failure
        // (binary missing, timeout, unreachable container) withholds evidence.
        const supervisorHasDaemons =
          supervisorRes.ok || supervisorRes.exitCode === 3;
        const parents = pidTreeRes.ok
          ? parsePidParents(pidTreeRes.stdout)
          : new Map<number, number>();

        const sockets: ComposeSocket[] = [];
        // R6: a daemon's reported pid can own more than one listening socket
        // (and `ss`'s own row order is not guaranteed) — a single-port map
        // made which port actually got the daemon attached depend on which
        // line `ss` printed first. Keep every port a pid owns.
        const pidToPort = new Map<number, number[]>();
        let socketsProbed = socketsRes.ok;
        if (socketsRes.ok) {
          for (const listener of parseSocketListeners(socketsRes.stdout)) {
            // Docker's embedded DNS resolver (127.0.0.11) listens inside
            // every container's netns on an ephemeral port — never a service
            // an operator or a dead-port diagnostic should ever name.
            if (listener.address === '127.0.0.11') continue;
            // A real in-container `ss -ltnpH` run as an unprivileged uid often
            // cannot see the PID of a root-owned listener (nginx on 80/443) —
            // the socket line itself still proves it is listening.
            sockets.push({
              containerPort: listener.port,
              address: listener.address,
            });
            if (listener.pid !== undefined) {
              const ports = pidToPort.get(listener.pid) ?? [];
              ports.push(listener.port);
              pidToPort.set(listener.pid, ports);
            }
          }
        } else {
          // C: `ss` may simply not be installed at all (exit 127) — images
          // like phpMyAdmin/OpenSearch ship neither `ss` nor `netstat` AND
          // have no published host binding (Traefik-only routing), so they
          // would otherwise stay `unknown` forever. Read the kernel's own
          // listener table directly instead of trusting any host binding
          // (Docker binds a host port whether or not anything listens).
          const [tcp, tcp6] = await Promise.all([
            deps.run('docker', ['exec', c.id, 'cat', '/proc/net/tcp']),
            deps.run('docker', ['exec', c.id, 'cat', '/proc/net/tcp6']),
          ]);
          if (tcp.ok || tcp6.ok) {
            socketsProbed = true;
            const seen = new Set<number>();
            for (const out of [tcp, tcp6]) {
              if (!out.ok) continue;
              for (const listener of parseProcNetTcp(out.stdout)) {
                if (listener.address === '127.0.0.11') continue;
                if (seen.has(listener.port)) continue;
                seen.add(listener.port);
                sockets.push({
                  containerPort: listener.port,
                  address: listener.address,
                });
              }
            }
            // `/proc/net/tcp` carries no pid column, so no daemon can be
            // attached to any of these sockets. Only worth flagging when
            // this container actually has supervisor-managed daemons to
            // lose (N1): phpMyAdmin/OpenSearch/`db` have none (exit 127),
            // and a diagnostic there would wrongly protect their stale
            // reap records forever.
            if (supervisorHasDaemons) {
              containerDiagnostics.push({
                source: 'web-sockets',
                message: `in-container socket probe for ${c.id} used the /proc/net/tcp fallback — no daemon names available`,
                containerId: c.id,
              });
            }
          } else {
            // Both probes failed outright — genuinely unknown, never dead,
            // so a missing probe binary cannot revoke a live route.
            containerDiagnostics.push({
              source: 'web-sockets',
              message: `in-container socket probe failed for ${c.id}`,
              containerId: c.id,
            });
          }
        }

        const unattachedDaemons: ComposeUnattachedDaemon[] = [];
        if (supervisorHasDaemons) {
          for (const entry of parseSupervisorStatus(supervisorRes.stdout)) {
            // Prefer an exact socket-pid match; a supervisor-managed daemon's
            // own reported pid is sometimes a forked child's parent rather
            // than the pid holding the socket, so fall back to walking the
            // process tree from each socket pid up to this supervisor pid.
            // R6: a pid can own more than one port — attach the daemon to
            // every one of them, not just whichever happened to match first.
            let ports = entry.pid ? pidToPort.get(entry.pid) : undefined;
            if (ports === undefined && entry.pid !== undefined) {
              for (const [socketPid, candidatePorts] of pidToPort) {
                if (isAncestor(parents, socketPid, entry.pid)) {
                  ports = candidatePorts;
                  break;
                }
              }
            }
            if (ports !== undefined && ports.length > 0) {
              for (const port of ports) {
                const idx = sockets.findIndex((s) => s.containerPort === port);
                if (idx >= 0) {
                  sockets[idx] = {
                    ...sockets[idx],
                    daemon: entry.daemon,
                    daemonStatus: entry.status,
                  } as ComposeSocket;
                }
              }
              continue;
            }
            // No live socket to attach to (typically STOPPED/EXITED).
            unattachedDaemons.push({
              daemon: entry.daemon,
              status: entry.status,
            });
          }
        } else if (
          supervisorRes.exitCode !== 127 &&
          !(
            supervisorRes.exitCode === 126 &&
            !isPermissionDenied126(supervisorRes.stderr)
          )
        ) {
          // D/4: exit 127 means `supervisorctl` is not installed in this
          // image at all (phpMyAdmin, OpenSearch, OpenSearch Dashboards,
          // `db`, …) — an absent tool is not a probe failure, just "this
          // container has no supervisor" (true of most non-web
          // containers), and must never withhold an unrelated reap record.
          // Exit 126 without a "permission denied" stderr signal is treated
          // the same way — some engines report a missing binary as 126
          // rather than 127, and this must not block a no-claim reap either.
          // Only a genuine execution failure (the binary exists but errored,
          // a real permission-denied 126, timed out, or the container could
          // not be reached at all) is diagnostic evidence.
          containerDiagnostics.push({
            source: 'supervisor',
            message: `supervisorctl status failed for ${c.id}`,
            containerId: c.id,
          });
        }

        return {
          container: {
            ...c,
            socketsProbed,
            sockets,
            unattachedDaemons,
          },
          diagnostics: containerDiagnostics,
        };
      },
    ),
  );

  const containers = perContainer.map((r) => r.container);
  for (const r of perContainer) diagnostics.push(...r.diagnostics);
  return { containers, diagnostics };
}
