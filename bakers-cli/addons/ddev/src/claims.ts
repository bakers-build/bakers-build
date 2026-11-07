// BB-676 Task 2 (spec v3 split) — claim raw observations into named,
// tunnel-ready DDEV services. A claimer consumes raw IDENTITIES (array
// indices into one `RawDiscovery` pass), never a global port number: two
// containers or two site rules can share a port, so "port already seen"
// would silently merge them.
//
// This package knows nothing CMS-specific: the web container's own router
// port names itself `web` (or `web-<host>` for an additional alias), exactly
// like every other DDEV service names from its compose/service-type/daemon
// evidence — a project's own application owns multisite/host-header policy,
// not this claimer (BB-681: no CMS-specific addon layered on top any more).
//
// Only a `healthy` claim produces `TunnelRule`s: an orphan, dead, stopped,
// unknown or not-exposed service is still reported — so `list` can show it —
// but never shareable.

import { normalizeHost } from './hosts.js';
import type {
  ClaimedService,
  ClaimStatus,
  DdevClaimContext,
  RawPort,
  TunnelRule,
} from './types.js';

/** Name a claimed service from the best evidence its raw row carries.
 *  `serviceType` (`com.ddev.service-type`) is the more specific name when a
 *  project happens to set it; `composeService` (`com.docker.compose.service`)
 *  is the label DDEV/compose actually sets on every container. A daemon name
 *  (a webextradaemon inside the shared web container) distinguishes
 *  mailpit/phpmyadmin/etc from the web container's own router port. */
function nameFromEvidence(
  p: RawPort,
  webExtraExposedPortNames?: ReadonlyMap<number, string>,
): string {
  if (p.daemon) {
    const name = p.daemon.includes(':') ? p.daemon.split(':')[1]! : p.daemon;
    return name.toLowerCase();
  }
  // B: a dead/live row for a `web_extra_exposed_ports`-declared service
  // (vite, xhgui, …) carries no `daemon` evidence once it stops listening —
  // its `composeService`/`serviceType` is still just `web` (the shared
  // container), which would otherwise collide with the primary web group's
  // own `web` key and get suffixed into an opaque `web-<hash>-<port>` row.
  // The declared name from `.ddev/config.yaml` is more specific evidence
  // than that shared container label, so it is checked first.
  if (p.containerPort !== undefined) {
    const declared = webExtraExposedPortNames?.get(p.containerPort);
    if (declared) return declared.toLowerCase();
  }
  if (p.serviceType) return p.serviceType.toLowerCase();
  if (p.composeService) return p.composeService.toLowerCase();
  if (p.virtualHost) {
    return p.virtualHost.split(',')[0]!.split('.')[0]!.toLowerCase();
  }
  return `service-${(p.containerId ?? 'unknown').slice(0, 8)}`;
}

/** The Traefik-routed target for a DDEV service: the ROUTER port DDEV's
 *  router/Traefik listens on at the host loopback — never the
 *  container-internal port, which only the rule's `direct` origin (dialled
 *  by a transport that reaches container IPs) uses. */
function routedServiceOf(p: RawPort): string {
  const port = p.routerPort ?? p.hostBoundPort ?? p.containerPort ?? 443;
  // B: an alias that only exists via HTTP_EXPOSE has no HTTPS listener behind
  // it at all — dialling `https://` there just fails. Default to `https`
  // only when we have no scheme evidence (e.g. a bare listening socket with
  // no expose rule attached).
  const scheme = p.exposeScheme === 'http' ? 'http' : 'https';
  return `${scheme}://127.0.0.1:${port}`;
}

function resolveStatus(p: RawPort): ClaimStatus {
  if (p.containerState === 'stopped') return 'stopped';
  if (p.daemonStatus === 'STOPPED' || p.daemonStatus === 'EXITED')
    return 'stopped';
  if (p.exposed === 'unknown' || p.listening === 'unknown') return 'unknown';
  if (p.exposed === true && p.listening === false) return 'dead';
  if (p.exposed === true && p.listening === true) return 'healthy';
  if (p.exposed === false && p.listening === true) return 'not-exposed';
  return 'unknown';
}

/** The sibling row carrying the SAME derived name that IS actually listening —
 *  diagnostic evidence for a dead claim (AC4: "vite is dead, 3002 is not"),
 *  never asserted as a verified substitute. */
function listeningSibling(
  raw: readonly RawPort[],
  containerId: string | undefined,
  excludeIdx: number,
): RawPort | undefined {
  if (!containerId) return undefined;
  // B: real DDEV topology never repeats a dead group's derived name on the
  // sibling that actually listens (e.g. vite is dead on 5173, the real
  // listener is a daemon like `pynq-members-dev` on 3002) — matching by name
  // never fires. Match by CONTAINER identity instead: any other row on the
  // same container that is genuinely listening is diagnostic evidence worth
  // surfacing.
  //
  // Critical finding 1: a container can have several genuinely-listening
  // rows (the web-container's internal nginx, Docker's own embedded DNS
  // stub, an actual webextradaemon). `127.0.0.11` (Docker's embedded DNS) is
  // already filtered out upstream, but a daemon-attached row is still the
  // most useful diagnostic evidence — name the thing an operator can
  // actually act on, not whichever row happens to come first.
  // A: a daemon that ALSO owns an exposed, healthy route elsewhere on the
  // same container (mailpit on its router-mapped port) is not the
  // diagnostic candidate an operator can "go use instead" — it already has
  // its own working tunnel. Only an unexposed row names the thing that is
  // actually, unexpectedly listening where the dead claim expected to find
  // nothing else. `ss`'s row order must not decide which daemon wins.
  const exposedDaemonNames = new Set(
    raw
      .filter(
        (p) =>
          p.containerId === containerId &&
          p.exposed === true &&
          p.daemon !== undefined,
      )
      .map((p) => p.daemon),
  );
  const candidates = raw.filter(
    (p, i) =>
      i !== excludeIdx &&
      p.containerId === containerId &&
      p.listening === true &&
      p.exposed === false &&
      p.address !== '127.0.0.11' &&
      !(p.daemon !== undefined && exposedDaemonNames.has(p.daemon)),
  );
  const webExtraDaemon = candidates.find((p) =>
    p.daemon?.startsWith('webextradaemons:'),
  );
  const anyDaemon = candidates.find((p) => p.daemon !== undefined);
  return webExtraDaemon ?? anyDaemon ?? candidates[0];
}

/**
 * DDEV claimer — every exposed HTTP(S) route of this worktree's containers,
 * coalesced (prefers HTTPS), named from service-type/daemon/VIRTUAL_HOST
 * evidence. The primary web-container router port names itself `web`, Host
 * rewritten through Traefik like any other DDEV service — no CMS-specific
 * policy lives here.
 */
export function claimDdev(
  raw: readonly RawPort[],
  remaining: Set<number>,
  ctx: DdevClaimContext,
): ClaimedService[] {
  const exposedIdxs = [...remaining].filter(
    (i) => raw[i]!.containerId !== undefined && raw[i]!.exposed !== undefined,
  );
  // Group by (containerId, containerPort) — NOT by routerPort, and NOT by
  // VIRTUAL_HOST: a service can be reachable through an HTTP_EXPOSE and an
  // HTTPS_EXPOSE mapping that target the SAME container port (any non-web
  // alias pair — mailpit, vite, … — follows this pattern); keying on router
  // port treats those as two distinct services.
  //
  // Live pynq-43 topology: DDEV's nginx ALSO listens on container port 443
  // internally even though HTTP_EXPOSE/HTTPS_EXPOSE both route to container
  // port 80 (Traefik terminates TLS itself and only ever forwards there) —
  // that stray, genuinely unexposed 443 socket is NOT part of the public web
  // service, so it must never be swept into the same group as the real
  // HTTP/HTTPS alias pair just because 80/443 are both traditionally
  // "the" web ports. The plain containerPort key already does the right
  // thing for both real shapes: the HTTP/HTTPS alias pair (same containerPort,
  // different routerPort) coalesces naturally; the unrelated 443-internal
  // socket gets its own group, surfacing separately as diagnostic evidence
  // (R2: a bare, unexposed sibling socket on the SAME containerPort as an
  // exposed row still joins that row's group — any other containerPort does not).
  const groups = new Map<string, number[]>();
  for (const i of exposedIdxs) {
    const p = raw[i]!;
    // N2: a port-less `unattachedDaemons` row (STOPPED/EXITED, no socket to
    // attach to) carries neither `containerPort` nor `routerPort`, so every
    // such row on the same container used to collapse into one `:unknown`
    // group — a RUNNING, port-less sibling (nginx/php-fpm) then won the
    // group and a STOPPED sibling (xhgui) silently vanished instead of
    // listing. Key port-less rows by daemon name so each keeps its own group.
    const groupKey =
      (p.containerPort ?? p.routerPort)
        ? `${p.containerId}:${p.containerPort ?? p.routerPort}`
        : `${p.containerId}:unknown:${p.daemon ?? 'unknown'}`;
    const entry = groups.get(groupKey) ?? [];
    entry.push(i);
    groups.set(groupKey, entry);
  }

  // B/duplicate-row fix: a group with no `containerPort` at all (an
  // `unattachedDaemons` row — e.g. the web container's internal `nginx`, or a
  // supervisor-listed daemon `ss`/the socket scan could not correlate to its
  // own already-discovered socket) is DIAGNOSTIC-ONLY evidence about a
  // container that already has a real, port-specific claim elsewhere. Once
  // that more specific claim exists, the containerPort-less group is a pure
  // duplicate of the same container and must not surface as its own row. A
  // container with NO other port-bearing group at all (e.g. `db`, which is
  // genuinely unclaimed) keeps its single generic row — this only suppresses
  // the redundant generic twin, never a genuinely unclaimed container.
  const containerIdsWithPort = new Set<string>();
  for (const i of exposedIdxs) {
    const p = raw[i]!;
    if (p.containerPort !== undefined && p.containerId !== undefined) {
      containerIdsWithPort.add(p.containerId);
    }
  }

  // Order groups so that the group whose name assignment MATTERS most (an
  // actually `healthy` route) claims the clean, unsuffixed name — never
  // whichever group happens to iterate first. Two sockets on the SAME
  // container can legitimately derive the identical baseName (phpMyAdmin's
  // extra loopback-only status socket next to its real port-80 listener;
  // OpenSearch's internal transport port 9300 next to its real 9200 API) —
  // a Map's insertion order is otherwise arbitrary, so the bare, operator-
  // facing key (`phpmyadmin`, not `phpmyadmin-<hash>-80`) could land on the
  // not-exposed diagnostic row instead of the one `ports up phpmyadmin`
  // actually needs to resolve to.
  const statusPriority: Record<ClaimStatus, number> = {
    healthy: 0,
    dead: 1,
    stopped: 2,
    unknown: 3,
    'not-exposed': 4,
  };
  const orderedGroups = [...groups.values()]
    .map((idxs, order) => {
      const sorted = [...idxs].sort((a, b) => {
        const score = (i: number) => (raw[i]!.exposeScheme === 'http' ? 1 : 0);
        return score(a) - score(b);
      });
      const best = raw[sorted[0]!]!;
      return { idxs: sorted, best, status: resolveStatus(best), order };
    })
    .sort((a, b) => {
      const byStatus = statusPriority[a.status] - statusPriority[b.status];
      return byStatus !== 0 ? byStatus : a.order - b.order;
    });

  const out: ClaimedService[] = [];
  const seenKeys = new Set<string>();

  for (const { idxs, best, status } of orderedGroups) {
    for (const i of idxs) remaining.delete(i);

    if (
      best.containerPort === undefined &&
      best.containerId !== undefined &&
      containerIdsWithPort.has(best.containerId) &&
      // Finding 5: only suppress a RUNNING twin (nginx's own internal
      // socket, or a daemon the socket scan already attached to a
      // port-bearing group elsewhere on this container) — a STOPPED/EXITED
      // `webextradaemons` entry (e.g. `xhgui`) has NO other representation
      // anywhere else and must still list, or it silently vanishes from
      // `list` instead of showing as `[stopped]`.
      (best.daemon === undefined || best.daemonStatus === 'RUNNING')
    ) {
      // Diagnostic-only twin of a container that already has a real claim
      // (nginx inside the web container, a daemon the socket scan already
      // matched elsewhere on this same container) — drop it, never render it
      // as its own row.
      continue;
    }

    const baseName = nameFromEvidence(best, ctx.webExtraExposedPortNames);
    // B: group identity is (containerId, containerPort) — never collapsed
    // across distinct groups just because two unrelated containers happen to
    // derive the same name. Only suffix when this exact key was already
    // produced by an EARLIER distinct group.
    const key = seenKeys.has(baseName)
      ? `${baseName}-${(best.containerId ?? '').slice(0, 8)}-${best.containerPort ?? 'na'}`
      : baseName;
    seenKeys.add(baseName);

    const rawPorts = idxs.map((i) => raw[i]!);
    let limitation: string | undefined;
    const rules: TunnelRule[] = [];
    let healthyService: string | undefined;

    if (status === 'dead') {
      const sibling = listeningSibling(raw, best.containerId, idxs[0]!);
      limitation = sibling
        ? `configured port ${best.routerPort ?? best.containerPort} is dead; ` +
          `${nameFromEvidence(sibling, ctx.webExtraExposedPortNames)} is listening on ` +
          `${sibling.containerPort} instead`
        : `configured port ${best.routerPort ?? best.containerPort} is dead`;
    } else if (status === 'healthy') {
      const service = routedServiceOf(best);
      healthyService = service;
      rules.push({
        key,
        service,
        ...(best.virtualHost
          ? { hostHeader: best.virtualHost.split(',')[0] }
          : {}),
        // N7: Traefik presents every DDEV-routed destination over HTTPS
        // with its own (mkcert/self-signed) certificate — `insecureTls`
        // belongs to the resolved TARGET's scheme, not to "is the router
        // port literally 443". `routedServiceOf` always resolves to
        // `https://`, so Mailpit's router 8026 needs this exactly as much
        // as Drupal's router 443 did; the old `routerPort === 443` check
        // silently skipped it for every other router port.
        ...(service.startsWith('https://') ? { insecureTls: true } : {}),
        // Transports that reach container IPs skip Traefik and keep the
        // public Host; the `web-<host>` aliases below need Traefik's
        // host-based routing, so they never get this.
        ...(best.containerIp && best.containerPort
          ? { direct: `http://${best.containerIp}:${best.containerPort}` }
          : {}),
      });
    }

    // Finding 6: name the actual router port an operator would dial —
    // `https://<vhost>` alone silently implies 443, which is wrong for every
    // non-default router port (Mailpit 8026, phpMyAdmin 8037, …).
    const localScheme = best.exposeScheme === 'http' ? 'http' : 'https';
    const localPort = best.routerPort;
    const localDefaultPort = localScheme === 'http' ? 80 : 443;
    const localSuffix =
      localPort && localPort !== localDefaultPort ? `:${localPort}` : '';
    out.push({
      key,
      claim: 'ddev',
      status,
      local: best.virtualHost
        ? `${localScheme}://${best.virtualHost.split(',')[0]}${localSuffix}`
        : `container:${best.containerId}`,
      ...(limitation ? { limitation } : {}),
      rawPorts,
      rules,
    });

    // BB-681 Task 1 — split the PRIMARY web group (the bare `web` key —
    // never a duplicate-suffixed or ancillary-service group) into one
    // additional claim per configured host, each named `web-<host-with-
    // hyphens-for-dots>`. An alias is only eligible when it is BOTH
    // configured (`ctx.hosts.additional`) AND observed in this group's own
    // VIRTUAL_HOST evidence — a configured-but-unobserved alias never
    // produces a confident claim.
    if (key === 'web' && status === 'healthy' && ctx.hosts && healthyService) {
      const observed = new Set(
        (best.virtualHost ?? '')
          .split(',')
          .map((h) => normalizeHost(h))
          .filter(Boolean),
      );
      const eligibleAliases = ctx.hosts.additional.filter((a) =>
        observed.has(a),
      );
      // BB-681 review M4: two DIFFERENT hosts can produce the SAME
      // `web-<key>` after replacing dots with hyphens (`admin.ddev-site` and
      // `admin-ddev.site` both become `web-admin-ddev-site`). Spec: "reject
      // collisions instead of selecting by list order" — detect every
      // colliding aliasKey across this one call BEFORE emitting any of
      // them, so neither alias is silently favored by iteration order.
      const keyCounts = new Map<string, number>();
      for (const alias of eligibleAliases) {
        const aliasKey = `web-${alias.replace(/\./g, '-')}`;
        keyCounts.set(aliasKey, (keyCounts.get(aliasKey) ?? 0) + 1);
      }
      for (const alias of eligibleAliases) {
        const aliasKey = `web-${alias.replace(/\./g, '-')}`;
        const colliding = (keyCounts.get(aliasKey) ?? 0) > 1;
        out.push({
          key: aliasKey,
          claim: 'ddev',
          status: 'healthy',
          local: `https://${alias}`,
          rawPorts,
          ...(colliding
            ? {
                limitation: `collides with another alias's normalized key '${aliasKey}' — neither is shareable`,
                rules: [],
              }
            : {
                rules: [
                  {
                    key: aliasKey,
                    service: healthyService,
                    hostHeader: alias,
                    ...(healthyService.startsWith('https://')
                      ? { insecureTls: true }
                      : {}),
                  },
                ],
              }),
        });
      }
    }
  }

  return out;
}
