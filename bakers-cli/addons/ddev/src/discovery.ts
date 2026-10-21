// BB-676 spec v2 — DDEV-specific interpretation of generic Docker Compose
// observations: `HTTP_EXPOSE`/`HTTPS_EXPOSE` router-port parsing and the
// `com.ddev.approot` worktree match. This is the only place in the ports
// pipeline that knows those conventions exist.

import {
  type ComposeContainer,
  type DockerComposeDeps,
  discoverCompose,
} from '@bakers-build/addon-docker-compose';
import type { RawDiagnostic, RawDiscovery, RawPort } from './types.js';

/**
 * DDEV's `HTTP_EXPOSE`/`HTTPS_EXPOSE` format: comma-separated
 * `routerPort:containerPort` pairs (a bare port means router===container).
 */
export function parseExposeMapping(
  value: string,
): Array<{ routerPort: number; containerPort: number }> {
  const out: Array<{ routerPort: number; containerPort: number }> = [];
  for (const raw of value.split(',')) {
    const part = raw.trim();
    if (!part) continue;
    const [a, b] = part.split(':');
    const routerPort = Number(a);
    const containerPort = Number(b ?? a);
    if (!Number.isInteger(routerPort) || !Number.isInteger(containerPort)) {
      continue;
    }
    out.push({ routerPort, containerPort });
  }
  return out;
}

/** Tag each parsed mapping with which `*_EXPOSE` var produced it, so later
 *  stages know the real scheme instead of guessing from the router port. */
function parseExposeMappingWithScheme(
  value: string,
  scheme: 'http' | 'https',
): Array<{
  routerPort: number;
  containerPort: number;
  scheme: 'http' | 'https';
}> {
  return parseExposeMapping(value).map((m) => ({ ...m, scheme }));
}

/** `.ddev/config.yaml`'s `web_extra_exposed_ports:` — a block sequence of
 *  `{name, container_port, http_port, https_port}` entries (real shape,
 *  captured live from a pynq-43 worktree):
 *  ```
 *  web_extra_exposed_ports:
 *    -
 *      name: vite
 *      container_port: 5173
 *      http_port: 5172
 *      https_port: 5173
 *  ```
 *  A targeted line-parser is enough — no need for a YAML dependency for one
 *  array. Keyed by `container_port` since that is what a claimed row's `containerPort`
 *  matches against (B: name a non-primary-web group from this before falling
 *  back to the web container's generic compose-service label).
 *
 *  DDEV accepts both block-sequence shapes — a lone `-` starting the entry
 *  (above) AND the inline form `- name: vite` with the first field on the
 *  same line as the dash (DDEV's own documented style). A line starting with
 *  `-` always begins a new entry either way; its remainder (if any) is the
 *  first field of that entry, not a lone separator to discard. */
export function parseWebExtraExposedPorts(
  configYaml: string | null,
): ReadonlyMap<number, string> {
  const out = new Map<number, string>();
  if (!configYaml) return out;
  const listMatch = /^web_extra_exposed_ports:\s*$/m.exec(configYaml);
  if (!listMatch) return out;
  const rest = configYaml.slice(listMatch.index + listMatch[0].length);
  const lines = rest.split('\n');
  let name: string | undefined;
  let containerPort: number | undefined;
  const flush = () => {
    if (name !== undefined && containerPort !== undefined) {
      out.set(containerPort, name);
    }
    name = undefined;
    containerPort = undefined;
  };
  const applyField = (field: string) => {
    const nameM = /^\s*name:\s*['"]?([^'"#\r\n]*?)['"]?\s*(?:#.*)?$/m.exec(
      field,
    );
    if (nameM?.[1]) {
      name = nameM[1].trim();
      return;
    }
    const portM = /^\s*container_port:\s*(\d+)\s*$/m.exec(field);
    if (portM?.[1]) {
      containerPort = Number(portM[1]);
    }
  };
  for (const line of lines) {
    if (line.trim() === '') continue;
    // A line with no leading indentation ends this top-level key's block.
    if (!/^\s/.test(line)) break;
    const dashM = /^(\s*)-(\s*)(.*)$/.exec(line);
    if (dashM) {
      flush();
      const remainder = dashM[3] ?? '';
      if (remainder.trim() !== '') applyField(remainder);
      continue;
    }
    applyField(line);
  }
  flush();
  return out;
}

function rawPortsForContainer(
  worktree: string,
  container: ComposeContainer,
): RawPort[] {
  const containerState: RawPort['containerState'] = container.running
    ? 'running'
    : 'stopped';
  const virtualHost = container.env.VIRTUAL_HOST;
  const serviceType = container.labels['com.ddev.service-type'];
  const composeService = container.labels['com.docker.compose.service'];
  // N8: DDEV allows `HTTP_EXPOSE` and `HTTPS_EXPOSE` on the SAME container at
  // once — a project can expose one router port over plain HTTP and a
  // different one over HTTPS. `??` read only one var, so the other's router
  // mappings were silently dropped whenever both were set; merge both sets
  // instead. A router port that appears in both wins by insertion order
  // (HTTPS mapping taken first, matching the single-source scheme's old
  // "HTTPS preferred" intent) rather than overwriting silently either way.
  const mappings = [
    ...(container.env.HTTPS_EXPOSE
      ? parseExposeMappingWithScheme(container.env.HTTPS_EXPOSE, 'https')
      : []),
    ...(container.env.HTTP_EXPOSE
      ? parseExposeMappingWithScheme(container.env.HTTP_EXPOSE, 'http')
      : []),
  ];

  // N8: a `Map<containerPort, RawPort>` can only ever hold ONE row per
  // container port, but with both expose vars set it is legitimate for the
  // SAME container port to be reachable through two different router ports
  // (e.g. `HTTP_EXPOSE=80:443` plus `HTTPS_EXPOSE=443:443`) — an array per
  // port preserves both instead of the second mapping silently clobbering
  // the first.
  const byPort = new Map<number, RawPort[]>();
  for (const mapping of mappings) {
    const arr = byPort.get(mapping.containerPort) ?? [];
    arr.push({
      worktree,
      containerId: container.id,
      containerPort: mapping.containerPort,
      routerPort: mapping.routerPort,
      exposeScheme: mapping.scheme,
      ...(virtualHost ? { virtualHost } : {}),
      ...(serviceType ? { serviceType } : {}),
      ...(composeService ? { composeService } : {}),
      ...(container.boundPorts.has(mapping.containerPort)
        ? { hostBoundPort: container.boundPorts.get(mapping.containerPort)! }
        : {}),
      containerState,
      exposed: true,
      // Not yet probed: stopped containers cannot listen; running ones are
      // resolved below, once (or left `unknown` if the probe itself failed
      // upstream in `@bakers-build/addon-docker-compose`).
      listening: containerState === 'running' ? 'unknown' : false,
    });
    byPort.set(mapping.containerPort, arr);
  }

  const ports: RawPort[] = [];
  const matchedPorts = new Set<number>();
  for (const socket of container.sockets) {
    matchedPorts.add(socket.containerPort);
    const existing = byPort.get(socket.containerPort);
    if (existing && existing.length > 0) {
      byPort.set(
        socket.containerPort,
        existing.map((row) => ({
          ...row,
          listening: true,
          ...(socket.pid !== undefined ? { pid: socket.pid } : {}),
          ...(socket.address !== undefined ? { address: socket.address } : {}),
          ...(socket.daemon !== undefined
            ? { daemon: socket.daemon, daemonStatus: socket.daemonStatus }
            : {}),
        })),
      );
    } else {
      // Listening but no exposure rule claims it — e.g. a daemon bound on
      // the wrong port, or an internal-only service (AC1). This is also
      // where the web container's own `nginx` 80/443 socket shows up when
      // `ss` cannot resolve its (root-owned) pid — attach its bound host
      // port here too (R2), so the claimer can still find a BB-500
      // passthrough target for it.
      ports.push({
        worktree,
        containerId: container.id,
        containerPort: socket.containerPort,
        ...(socket.pid !== undefined ? { pid: socket.pid } : {}),
        ...(socket.address !== undefined ? { address: socket.address } : {}),
        ...(serviceType ? { serviceType } : {}),
        ...(composeService ? { composeService } : {}),
        ...(socket.daemon !== undefined
          ? { daemon: socket.daemon, daemonStatus: socket.daemonStatus }
          : {}),
        ...(container.boundPorts.has(socket.containerPort)
          ? { hostBoundPort: container.boundPorts.get(socket.containerPort)! }
          : {}),
        containerState,
        exposed: false,
        listening: true,
      });
    }
  }
  // Exposure rows the socket scan did NOT confirm are genuinely dead — but
  // only when the probe itself succeeded; a failed probe means "unknown",
  // never "dead", so a missing probe binary cannot revoke a live route.
  //
  // C: `@bakers-build/addon-docker-compose`'s `discoverCompose` now falls back to
  // reading `/proc/net/tcp`(6) directly whenever `ss` is missing/fails
  // outright (images like phpMyAdmin/OpenSearch ship neither `ss` nor
  // `netstat`), so `container.socketsProbed` is already `true` whenever
  // EITHER probe succeeded, and matched ports from that fallback already
  // flow through `matchedPorts` above. A row that reaches here with
  // `socketsProbed` still `false` means both probes genuinely failed — that
  // is `unknown`, never a guess from a published host port binding (Docker
  // binds a host port whether or not anything inside actually listens, so
  // trusting it as proof of health reads a dead port as healthy just as
  // often as it rescues a truly-unprobable one).
  for (const [port, rows] of byPort) {
    byPort.set(
      port,
      rows.map((row) =>
        matchedPorts.has(port)
          ? row
          : container.socketsProbed
            ? { ...row, listening: false }
            : row,
      ),
    );
  }
  for (const rows of byPort.values()) ports.push(...rows);

  for (const daemon of container.unattachedDaemons) {
    ports.push({
      worktree,
      containerId: container.id,
      daemon: daemon.daemon,
      daemonStatus: daemon.status,
      containerState,
      exposed: 'unknown',
      listening: false,
    });
  }

  const containerIp = container.networks.get('ddev_default');
  return containerIp ? ports.map((row) => ({ ...row, containerIp })) : ports;
}

/**
 * Discover this worktree's DDEV-exposed ports: every container the
 * `com.ddev.approot` label (unioned with the generic compose working-dir
 * label, `@bakers-build/addon-docker-compose`'s own filter) matches, interpreted
 * through `HTTP(S)_EXPOSE`/`VIRTUAL_HOST`.
 */
export async function discoverDdevPorts(
  worktree: string,
  deps: DockerComposeDeps,
): Promise<RawDiscovery> {
  const { containers, diagnostics: composeDiagnostics } = await discoverCompose(
    worktree,
    deps,
    { extraLabelFilters: ['com.ddev.approot'] },
  );
  const diagnostics: RawDiagnostic[] = [...composeDiagnostics];
  const ports: RawPort[] = [];
  for (const container of containers) {
    ports.push(...rawPortsForContainer(worktree, container));
  }
  return { ports, diagnostics };
}
