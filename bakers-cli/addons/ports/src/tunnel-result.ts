// BB-676 Task 4 — the `tunnel` message's Markdown answer (BB-661 contract
// 2): one bullet per CLAIMED service, driven by the machine's applied/pending/
// error record for its key rather than a per-route PID. Two site keys sharing
// a base name (e.g. `drupal-admin`, `drupal-members`) each render their own
// line (plan review focus 3): matching is by `key`, never by a shared port.

import type { ClaimedDiscovery, ClaimedService } from './claims.js';
import type { TunnelDesiredRecord } from './core.js';

function serviceLine(
  service: ClaimedService,
  record: TunnelDesiredRecord | undefined,
): string {
  const limitation = service.limitation ? ` — ${service.limitation}` : '';
  if (service.status === 'stopped') {
    return `- ${service.key} (${service.claim}) — not running`;
  }
  if (service.rules.length === 0) {
    return `- ${service.key} (${service.claim}) — no addon${limitation}`;
  }
  if (!record || record.desired !== 'present') {
    return `- ${service.key} (${service.claim}) — local only: ${service.local}${limitation}`;
  }
  if (record.applied === 'applied') {
    // The ACTUAL confirmed `record.url` wins when the transport reports one
    // (e.g. Quick's allocated hostname, which is never predictable ahead of
    // time); only a zone-based transport's stable `hostname` falls back to
    // the derived `https://` URL.
    const url = record.url ?? `https://${record.hostname}`;
    return `- ${service.key} (${service.claim}) — [${url}](${url}) (local: ${service.local})${limitation}`;
  }
  if (record.applied === 'error') {
    return `- ${service.key} (${service.claim}) — failed to share: ${record.error ?? 'unknown error'}`;
  }
  return `- ${service.key} (${service.claim}) — pending`;
}

export function tunnelMarkdown(
  discovery: ClaimedDiscovery,
  records: readonly TunnelDesiredRecord[],
  failures: readonly { service: ClaimedService; message: string }[] = [],
): string {
  const byKey = new Map(records.map((r) => [r.key, r]));
  const lines = discovery.services.map((s) => serviceLine(s, byKey.get(s.key)));
  for (const failure of failures) {
    if (byKey.get(failure.service.key)?.applied === 'error') continue;
    lines.push(
      `- ${failure.service.key} (${failure.service.claim}) — failed to share: ${failure.message}`,
    );
  }
  return lines.length > 0
    ? lines.join('\n')
    : 'No services found in this worktree.';
}
