// BB-676 Task 3, generalized by BB-681 Task 2 into this package's own
// `PortsTransport.reconcile` — DNS create/adopt + the complete ingress
// upload, in the order a crash can recover from: an active record without
// an owned CNAME gets one BEFORE the ingress that names its hostname is
// uploaded (so a hostname never resolves before its route exists); a
// reduced ingress is uploaded BEFORE an absent record's CNAME is deleted
// (so the public URL stops routing before the DNS name that reached it
// disappears). Returns the records with updated `applied`/`data.dnsRecordId`
// /`error` — the generic layer (`tunnel-ops.ts`) persists them.

import type { TunnelDesiredRecord } from '@bakers-build/addon-ports/transport';
import { upsertRecord } from '@bakers-build/addon-ports/transport';
import {
  type CfIngressRule,
  type CloudflareConfig,
  type CloudflareDeps,
  createDnsRecord,
  deleteDnsRecord,
  findDnsRecord,
  getIngressConfig,
  putIngressConfig,
  tunnelCnameTarget,
} from './cloudflare.js';

function dnsRecordId(record: TunnelDesiredRecord): string | undefined {
  const v = record.data?.dnsRecordId;
  return typeof v === 'string' ? v : undefined;
}

function withDnsRecordId(
  record: TunnelDesiredRecord,
  id: string | undefined,
): TunnelDesiredRecord {
  return {
    ...record,
    data: id === undefined ? undefined : { dnsRecordId: id },
  };
}

export interface ReconcileContext {
  readonly signal?: AbortSignal;
  checkpoint(records: readonly TunnelDesiredRecord[]): Promise<void>;
}

export async function reconcileCloudflare(
  records: readonly TunnelDesiredRecord[],
  cfg: CloudflareConfig,
  deps: CloudflareDeps,
  context: ReconcileContext,
): Promise<{
  readonly records: readonly TunnelDesiredRecord[];
  readonly ok: boolean;
}> {
  let next = records;
  let ok = true;

  const active = next.filter((r) => r.desired === 'present');
  // Records whose DNS create/adopt itself failed (e.g. a foreign-owned exact
  // name): they still ride along in the ingress upload below so one bad
  // record can't drop its siblings, but they must not be reported `applied`
  // just because the PUT happened to succeed — there's no DNS pointing at
  // them. Track their ids to preserve that `error` through the PUT phase.
  const dnsErrorIds = new Set<string>();
  for (const record of active) {
    if (dnsRecordId(record)) continue;
    try {
      const existing = await findDnsRecord(cfg, record.hostname!, deps);
      if (existing && existing.content !== tunnelCnameTarget(cfg)) {
        throw new Error(
          `${record.hostname} already has a DNS record this tunnel does not own`,
        );
      }
      let id = existing?.id;
      if (id === undefined) {
        try {
          id = (await createDnsRecord(cfg, record.hostname!, deps)).id;
        } catch (err) {
          // Uncertain create (e.g. the request succeeded remotely but the
          // response was ambiguous, or this is a retry after a timeout):
          // reconcile against the live state by exact hostname+content match
          // rather than assuming failure (which would otherwise risk a
          // duplicate record on the next attempt).
          const recheck = await findDnsRecord(
            cfg,
            record.hostname!,
            deps,
          ).catch(() => null);
          if (recheck && recheck.content === tunnelCnameTarget(cfg)) {
            id = recheck.id;
          } else {
            throw err;
          }
        }
      }
      next = upsertRecord(
        next,
        withDnsRecordId(
          { ...record, applied: 'pending', error: undefined },
          id,
        ),
      );
      // Checkpoint DNS ownership immediately after acquiring/confirming it —
      // don't wait until the whole reconcile finishes to record that this
      // process now owns a DNS record (so a crash before the ingress PUT
      // still leaves ownership discoverable on the next reconcile).
      await context.checkpoint(next);
    } catch (err) {
      ok = false;
      dnsErrorIds.add(`${record.worktree}:${record.key}`);
      next = upsertRecord(next, {
        ...record,
        applied: 'error',
        // CloudflareApiError messages are already redacted (`cloudflare.ts`);
        // a non-Cloudflare error (e.g. a thrown plain Error) carries only its
        // own message, never a raw fetch payload or token.
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // The ingress is built from every `present` record, including ones whose
  // DNS/apply state is `error` — otherwise one failed record would silently
  // drop every other worktree's already-working route from the next upload.
  const stillActive = next.filter((r) => r.desired === 'present');
  // Remote config check first (I1): refuse to replace rules this tunnel does
  // not own, rather than silently overwriting an out-of-band dashboard edit.
  try {
    const remote = await getIngressConfig(cfg, deps);
    // Every hostname this tunnel identity has ever recorded is "managed",
    // present or absent (N1): an `absent` record's hostname can still be in
    // the remote ingress for one more reconcile (the PUT below removes it),
    // and treating only `present` names as known wedges every later up/down
    // the moment a single `down` runs, because the just-removed hostname then
    // reads as a foreign unmanaged rule.
    const expectedHostnames = new Set(
      next.map((r) => r.hostname).filter((h): h is string => h !== undefined),
    );
    const unmanaged = remote.ingress.filter(
      (rule) =>
        typeof rule.hostname === 'string' &&
        !expectedHostnames.has(rule.hostname),
    ) as { hostname: string }[];
    if (unmanaged.length > 0) {
      throw new Error(
        `refusing to replace unmanaged ingress rule(s): ${unmanaged.map((r) => r.hostname).join(', ')}`,
      );
    }
  } catch (err) {
    ok = false;
    const message = err instanceof Error ? err.message : String(err);
    for (const r of stillActive) {
      next = upsertRecord(next, { ...r, applied: 'pending', error: message });
    }
    return { records: next, ok };
  }

  // BB-681 Task 2 — translate the neutral record (`hostHeader`/
  // `insecureTls`) into Cloudflare's own `originRequest` shape HERE, the only
  // place that knows Cloudflare's field names. Omission of `insecureTls`
  // NEVER disables TLS verification (absent/false means verified) — only an
  // explicit `true` sets `noTLSVerify: true`.
  const ingress: CfIngressRule[] = [
    ...stillActive
      .slice()
      .sort((a, b) => (a.hostname ?? '').localeCompare(b.hostname ?? ''))
      .map((r) => ({
        ...(r.hostname !== undefined ? { hostname: r.hostname } : {}),
        service: r.service,
        ...(r.hostHeader || r.insecureTls
          ? {
              originRequest: {
                ...(r.hostHeader ? { httpHostHeader: r.hostHeader } : {}),
                ...(r.insecureTls ? { noTLSVerify: true } : {}),
              },
            }
          : {}),
      })),
    { service: 'http_status:404' },
  ];

  try {
    await putIngressConfig(cfg, ingress, deps);
    for (const r of stillActive) {
      if (dnsErrorIds.has(`${r.worktree}:${r.key}`)) continue;
      // Applied only when BOTH the ingress route and the owned DNS record are
      // confirmed — the DNS phase above already confirmed ownership for
      // every id that isn't in `dnsErrorIds`.
      next = upsertRecord(next, {
        ...r,
        applied: 'applied',
        error: undefined,
        url: r.hostname ? `https://${r.hostname}` : r.url,
      });
    }
  } catch (err) {
    ok = false;
    const message = err instanceof Error ? err.message : String(err);
    for (const r of stillActive) {
      // 'pending', not 'error': an upload failure is retryable and must not
      // permanently drop this record from the next reconcile's ingress.
      next = upsertRecord(next, { ...r, applied: 'pending', error: message });
    }
    // The ingress upload failed: nothing routes yet, so deleting an absent
    // record's DNS now would be deleting the name for a route that is still
    // live. Stop before the DNS-deletion phase.
    return { records: next, ok };
  }

  // A desired-absent record with no DNS record ever created has nothing to
  // delete remotely (M3) — drop its tombstone immediately rather than only
  // ones that went through the create/adopt path.
  const absent = next.filter((r) => r.desired === 'absent' && dnsRecordId(r));
  const noOpAbsentIds = new Set(
    next
      .filter((r) => r.desired === 'absent' && !dnsRecordId(r))
      .map((r) => `${r.worktree}:${r.key}`),
  );
  next = next.filter(
    (r) =>
      !(r.desired === 'absent' && noOpAbsentIds.has(`${r.worktree}:${r.key}`)),
  );
  const kept: TunnelDesiredRecord[] = [];
  for (const record of absent) {
    const id = dnsRecordId(record)!;
    try {
      const existing = await findDnsRecord(cfg, record.hostname!, deps);
      if (
        existing &&
        existing.id === id &&
        existing.content === tunnelCnameTarget(cfg)
      ) {
        await deleteDnsRecord(cfg, id, deps);
      }
      // Tombstone cleared — drop it from the returned set entirely.
      await context.checkpoint(
        next.filter(
          (r) =>
            `${r.worktree}:${r.key}` !== `${record.worktree}:${record.key}`,
        ),
      );
    } catch (err) {
      // Failed-cleanup tombstone: teardown partially failed, so this record
      // stays (with its DNS id preserved) recording what's left to clean up,
      // rather than the state losing track of it. Sibling records are
      // unaffected — this loop never touches any key but its own.
      ok = false;
      kept.push({
        ...record,
        applied: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  const absentIds = new Set(absent.map((r) => `${r.worktree}:${r.key}`));
  next = next
    .filter(
      (r) =>
        !(r.desired === 'absent' && absentIds.has(`${r.worktree}:${r.key}`)),
    )
    .concat(kept);

  return { records: next, ok };
}
