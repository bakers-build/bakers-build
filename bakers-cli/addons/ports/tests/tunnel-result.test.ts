import { describe, expect, it } from 'vitest';
import type { ClaimedDiscovery, ClaimedService } from '../src/claims.js';
import type { TunnelDesiredRecord } from '../src/core.js';
import { tunnelMarkdown } from '../src/tunnel-result.js';

function service(
  overrides: Partial<ClaimedService> & { key: string },
): ClaimedService {
  return {
    claim: 'ddev',
    status: 'healthy',
    local: `https://${overrides.key}.ddev.site`,
    rawPorts: [],
    rules: [{ key: overrides.key, service: 'https://127.0.0.1:443' }],
    ...overrides,
  };
}

function record(
  overrides: Partial<TunnelDesiredRecord> & { key: string },
): TunnelDesiredRecord {
  return {
    worktree: '/wt',
    ticket: 'PYNQ-42',
    key: overrides.key,
    hostname: `pynq-42-${overrides.key}.example.test`,
    service: 'https://127.0.0.1:443',
    desired: 'present',
    applied: 'applied',
    ...overrides,
  };
}

describe('tunnelMarkdown', () => {
  it('lists an applied service with its tunnel URL and local address', () => {
    const discovery: ClaimedDiscovery = {
      services: [service({ key: 'drupal-admin' })],
    };
    const markdown = tunnelMarkdown(discovery, [
      record({ key: 'drupal-admin' }),
    ]);
    expect(markdown).toContain(
      '[https://pynq-42-drupal-admin.example.test](https://pynq-42-drupal-admin.example.test)',
    );
    expect(markdown).toContain('local: https://drupal-admin.ddev.site');
  });

  it('renders two site keys on the same router port as two separate lines', () => {
    const discovery: ClaimedDiscovery = {
      services: [
        service({ key: 'drupal-admin' }),
        service({ key: 'drupal-members' }),
      ],
    };
    const markdown = tunnelMarkdown(discovery, [
      record({ key: 'drupal-admin' }),
      record({ key: 'drupal-members' }),
    ]);
    expect(markdown).toContain('drupal-admin');
    expect(markdown).toContain('drupal-members');
    expect(markdown).toContain('pynq-42-drupal-admin.example.test');
    expect(markdown).toContain('pynq-42-drupal-members.example.test');
  });

  it('states a stopped service rather than omitting it', () => {
    const discovery: ClaimedDiscovery = {
      services: [service({ key: 'xhgui', status: 'stopped', rules: [] })],
    };
    expect(tunnelMarkdown(discovery, [])).toContain('not running');
  });

  it('states an unclaimed/dead service as "no addon" rather than omitting it', () => {
    const discovery: ClaimedDiscovery = {
      services: [
        service({
          key: 'vite',
          status: 'dead',
          rules: [],
          limitation:
            'configured port 5173 is dead; nuxt is listening on 3002 instead',
        }),
      ],
    };
    const markdown = tunnelMarkdown(discovery, []);
    expect(markdown).toContain('no addon');
    expect(markdown).toContain('configured port 5173 is dead');
  });

  it('never claims a live route from a pending or error record', () => {
    const discovery: ClaimedDiscovery = {
      services: [service({ key: 'drupal-admin' })],
    };
    const pending = tunnelMarkdown(discovery, [
      record({ key: 'drupal-admin', applied: 'pending' }),
    ]);
    expect(pending).toContain('pending');
    expect(pending).not.toContain('example.test');
    const errored = tunnelMarkdown(discovery, [
      record({
        key: 'drupal-admin',
        applied: 'error',
        error: 'DNS create failed',
      }),
    ]);
    expect(errored).toContain('failed to share: DNS create failed');
  });

  it('surfaces the Drupal fallback login limitation', () => {
    const discovery: ClaimedDiscovery = {
      services: [
        service({
          key: 'drupal',
          limitation: 'anonymous preview; tunnel login unsupported',
        }),
      ],
    };
    const markdown = tunnelMarkdown(discovery, [record({ key: 'drupal' })]);
    expect(markdown).toContain('tunnel login unsupported');
  });

  it('says so when nothing is found', () => {
    expect(tunnelMarkdown({ services: [] }, [])).toBe(
      'No services found in this worktree.',
    );
  });
});
