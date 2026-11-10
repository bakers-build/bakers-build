// The Overview tab of a conductor names each credential warning and error.
import { describe, expect, it } from 'vitest';
import { loadConductorDetail } from '../../src/Entity/conductor/Data/detail.js';
import { conductorOverviewRows } from '../../src/Entity/conductor/Screen/conductor-overview.js';
import type { DropshClient } from '../../src/types.js';

const NOW = Math.floor(Date.parse('2026-11-10T12:00:00Z') / 1000);

function clientFor(credentialHealth: unknown): DropshClient {
  return {
    get: async () => ({
      data: {
        id: 'c1',
        type: 'bb_conductor--bb_conductor',
        attributes: {
          label: 'north',
          status: 'online',
          last_seen: NOW,
          credential_health: credentialHealth,
        },
      },
    }),
  } as unknown as DropshClient;
}

describe('conductor credentials', () => {
  it('lists warnings and errors after the overview rows, skipping ok ones', async () => {
    const detail = await loadConductorDetail(
      clientFor(
        JSON.stringify([
          { name: 'github', status: 'ok', reason: 'accepted' },
          {
            name: 'codex',
            status: 'warning',
            expires_at: '2026-11-24',
            reason: 'expires on 2026-11-24, in 14 days',
          },
          {
            name: 'claude',
            status: 'error',
            reason: 'claude: not logged in — run claude /login',
          },
        ]),
      ),
      'c1',
      NOW,
    );
    expect(conductorOverviewRows(detail, NOW).slice(-2)).toEqual([
      'Credential warning: codex — expires on 2026-11-24, in 14 days',
      'Credential error: claude — claude: not logged in — run claude /login',
    ]);
  });

  it('shows nothing for a conductor that reported no credentials or garbage', async () => {
    for (const value of [undefined, null, '', 'not json', '{"a":1}']) {
      const detail = await loadConductorDetail(clientFor(value), 'c1', NOW);
      expect(detail.credentials).toEqual([]);
      expect(
        conductorOverviewRows(detail, NOW).some((r) =>
          r.startsWith('Credential'),
        ),
      ).toBe(false);
    }
  });
});
