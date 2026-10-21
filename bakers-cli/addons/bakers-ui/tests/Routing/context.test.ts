import { describe, expect, it } from 'vitest';
import {
  ContextBag,
  contextsForParams,
  defineContext,
  projectContext,
  runContext,
  ticketContext,
} from '../../src/Routing/context.js';

describe('ContextBag', () => {
  it('composes production scope references from routed parameters', () => {
    const bag = contextsForParams({
      projectId: 'p1',
      projectName: 'bakers.build',
      ticketId: 't1',
      runId: 'r1',
    });

    expect(bag.get(projectContext)).toEqual({
      id: 'p1',
      name: 'bakers.build',
      slug: 'bakers.build',
    });
    expect(bag.get(ticketContext)).toEqual({ id: 't1' });
    expect(bag.get(runContext)).toEqual({ id: 'r1' });
    expect(bag.scopeKey()).toBe('project:p1|run:r1|ticket:t1');
  });

  it('composes typed role-named values and derives a stable scope key', () => {
    const project = defineContext<{ id: string }>('project', 'scope');
    const viewer = defineContext<{ id: string }>('viewer', 'global');
    const subject = defineContext<{ id: string }>('subject-user', 'scope');
    const bag = ContextBag.empty()
      .set(project, { id: 'p1' })
      .set(viewer, { id: 'me' })
      .set(subject, { id: 'u1' });

    expect(bag.get(project)).toEqual({ id: 'p1' });
    expect(bag.scopeKey()).toBe('project:p1|subject-user:u1');
    expect(() => ContextBag.empty().get(project)).toThrow(
      'missing route context: project',
    );
  });

  it('returns a new bag without mutating or aliasing values', () => {
    const project = defineContext<{ id: string }>('project', 'scope');
    const value = { id: 'p1' };
    const empty = ContextBag.empty();
    const populated = empty.set(project, value);
    value.id = 'changed';

    expect(() => empty.get(project)).toThrow();
    expect(populated.get(project)).toEqual({ id: 'p1' });
    expect(Object.isFrozen(populated.get(project))).toBe(true);
  });
});
