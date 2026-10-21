import { describe, expect, it, vi } from 'vitest';
import {
  PROJECT_FILTER_FORM,
  type ProjectFilterOptions,
  type ProjectFilterState,
} from '../../../../src/Entity/ticket/Form/project-filter.js';
import {
  PROJECT_MIN_QUERY_LENGTH,
  projectOptionSource,
} from '../../../../src/Entity/ticket/Form/project-source.js';
import { fakeClient } from '../../../test-support.js';

const CANDIDATES = [
  { id: 'p1', label: 'Alpha' },
  { id: 'p2', label: 'Alpine' },
];

const opts: ProjectFilterOptions = { projects: CANDIDATES };

const initial = (): ProjectFilterState => PROJECT_FILTER_FORM.initial(opts);

describe('PROJECT_FILTER_FORM', () => {
  it('declares exactly the one autocomplete field over the projects bag', () => {
    const fields = PROJECT_FILTER_FORM.fields;
    expect(fields.map((f) => f.id)).toEqual(['project']);
    const project = fields[0];
    expect(project?.kind).toBe('autocomplete');
    expect(project?.label).toBe('Project');
    expect(project?.from).toBe('projects');
    expect(project?.query).toBe('projectQuery');
  });

  it('starts with nothing picked and an empty query', () => {
    const s = initial();
    expect(s.project).toBeNull();
    expect(s.projectQuery).toBe('');
    expect(PROJECT_FILTER_FORM.toObject(s, opts)).toBeNull();
  });

  it('a pick yields the projects payload (id + label)', () => {
    let s = initial();
    s = PROJECT_FILTER_FORM.apply(s, opts, { kind: 'insert', text: 'a' });
    s = PROJECT_FILTER_FORM.apply(s, opts, { kind: 'pick' });
    expect(s.project).toBe('p1');
    expect(PROJECT_FILTER_FORM.toObject(s, opts)).toEqual({
      id: 'p1',
      label: 'Alpha',
    });
  });

  it('a pick no longer in the bag yields null, not a phantom id', () => {
    const stale: ProjectFilterState = { ...initial(), project: 'gone' };
    expect(PROJECT_FILTER_FORM.toObject(stale, opts)).toBeNull();
  });

  it('an absent bag is a legal state — the payload is null', () => {
    const s = PROJECT_FILTER_FORM.initial({});
    expect(s.project).toBeNull();
    expect(PROJECT_FILTER_FORM.toObject(s, {})).toBeNull();
  });
});

describe('projectOptionSource', () => {
  it('returns an empty bag for queries below the two-character gate', async () => {
    const client = fakeClient({});
    const source = projectOptionSource(client);
    expect(await source.load('a')).toEqual({ options: [] });
    expect(await source.load('')).toEqual({ options: [] });
  });

  it('issues a server query when the query meets the threshold', async () => {
    const client = fakeClient({
      documents: {
        'bb_project/bb_project': {
          data: [
            { id: 'p1', attributes: { name: 'Alpha' } },
            { id: 'p2', attributes: { name: 'Alpine' } },
          ],
        },
      },
    });
    const source = projectOptionSource(client);
    const outcome = await source.load('al');
    expect(outcome.options).toEqual([
      { id: 'p1', label: 'Alpha' },
      { id: 'p2', label: 'Alpine' },
    ]);
    expect(outcome.error).toBeUndefined();
  });

  it('propagates read errors in the outcome, not as a thrown rejection', async () => {
    const client = {
      get: vi.fn(async () => {
        throw new Error('boom');
      }),
    };
    const source = projectOptionSource(client as never);
    const outcome = await source.load('al');
    expect(outcome.options).toEqual([]);
    expect(outcome.error).toBe('boom');
  });

  it('reports the minimum query length as the constant', () => {
    expect(PROJECT_MIN_QUERY_LENGTH).toBe(2);
  });
});
