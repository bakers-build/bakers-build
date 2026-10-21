import { describe, expect, it } from 'vitest';
import { bootLocationFor, buildRoutes } from '../../src/Routing/routes.js';

describe('root work navigation', () => {
  it('boots on My work when no deep route was requested', () => {
    expect(bootLocationFor()).toEqual({ routeId: 'my.work', params: {} });
  });

  it('fails closed for Members and preserves the confirmed root order', () => {
    expect(
      buildRoutes()
        .tabs('root')
        .map((tab) => tab.label),
    ).toEqual(['My work', 'Stats', 'Projects', 'Teams', 'Conductors']);
    expect(
      buildRoutes([], true)
        .tabs('root')
        .map((tab) => tab.label),
    ).toEqual([
      'My work',
      'Stats',
      'Projects',
      'Teams',
      'Members',
      'Conductors',
    ]);
  });

  it('returns unscoped ticket and run deep links to root My work', () => {
    const navigation = buildRoutes().createSession({}).navigation();
    for (const routeId of [
      'ticket.detail',
      'ticket.comments',
      'ticket.runs',
      'run.detail',
    ]) {
      expect(
        navigation.fallback(routeId, { ticketId: 'ticket-1', runId: 'run-1' }),
      ).toEqual({ routeId: 'my.work', params: {} });
    }
  });
});
