import { describe, expect, it, vi } from 'vitest';
import { buildRoutes } from '../../src/Routing/routes.js';

describe('navigation surfaces', () => {
  it.each([
    'keyboard-tab',
    'mouse-tab',
    'deep-link',
    'screen-action',
  ])('%s converges on Router.navigate', (surface) => {
    const navigate = vi.fn();
    const fixtures: Record<string, () => void> = {
      'keyboard-tab': () => navigate('project.runs', { projectId: 'p1' }),
      'mouse-tab': () => navigate('project.runs', { projectId: 'p1' }),
      'deep-link': () => navigate('project.runs', { projectId: 'p1' }),
      'screen-action': () => navigate('project.runs', { projectId: 'p1' }),
    };
    fixtures[surface]?.();
    expect(navigate).toHaveBeenCalledExactlyOnceWith('project.runs', {
      projectId: 'p1',
    });
  });
});

describe('contextual member navigation', () => {
  const workspaceParams = {
    workspaceId: 'workspace-1',
    userId: 'user-1',
    userName: 'Ada',
  };
  const teamParams = {
    teamId: 'team-1',
    teamName: 'Platform',
    userId: 'user-1',
    userName: 'Ada',
  };

  it('returns direct member routes to their originating roster', () => {
    const navigation = buildRoutes([], true).navigation;
    expect(
      navigation.fallback('workspace.member.overview', workspaceParams),
    ).toEqual({ routeId: 'workspace.members', params: workspaceParams });
    expect(navigation.fallback('team.member.overview', teamParams)).toEqual({
      routeId: 'team.members',
      params: teamParams,
    });
  });

  it('registers the entire workspace-member surface only for leads', () => {
    expect(
      buildRoutes([], false)
        .ids()
        .filter((id) => id.startsWith('workspace.member.')),
    ).toEqual([]);
    expect(buildRoutes([], true).ids()).toContain('workspace.member.overview');
  });

  it('retains both parent and selected-member route contexts', () => {
    const navigation = buildRoutes([], true).navigation;
    expect(
      navigation
        .contexts('workspace.member.overview', workspaceParams)
        .scopeKey(),
    ).toContain('workspace:workspace-1');
    expect(
      navigation.contexts('team.member.overview', teamParams).scopeKey(),
    ).toBe('team:team-1|user:user-1');
  });
});
