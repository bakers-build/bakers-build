import { describe, expect, it, vi } from 'vitest';
import {
  loadProjectCandidates,
  PROJECT_PAGE_SIZE,
} from '../../../../src/Entity/ticket/Data/projects-search.js';
import { fakeClient } from '../../../test-support.js';

const PATH = 'bb_project/bb_project';

const project = (id: string, name: string) => ({
  type: 'bb_project--bb_project',
  id,
  attributes: { name },
});

const docs = (rows: ReturnType<typeof project>[]) => ({
  [PATH]: { data: rows },
});

describe('loadProjectCandidates', () => {
  it('maps each row to id + name, and nothing else', async () => {
    const client = fakeClient({
      documents: docs([project('p1', 'Alpha'), project('p2', 'Alpine')]),
    });
    const outcome = await loadProjectCandidates(client, 'al');
    expect(outcome.rows).toEqual([
      { id: 'p1', name: 'Alpha' },
      { id: 'p2', name: 'Alpine' },
    ]);
    expect(outcome.error).toBeUndefined();
  });

  it('emits a CONTAINS filter when the query is non-empty', async () => {
    const client = fakeClient({
      documents: docs([project('p1', 'Alpha')]),
    });
    await loadProjectCandidates(client, 'al');
    const s = decodeURIComponent(
      client.requests[0]?.params?.getQueryString() ?? '',
    );
    expect(s).toContain('filter[name]');
    expect(s).toContain('CONTAINS');
    expect(s).toContain('al');
  });

  it('omits the name filter when the query is empty', async () => {
    const client = fakeClient({
      documents: docs([project('p1', 'Alpha')]),
    });
    await loadProjectCandidates(client, '');
    const s = decodeURIComponent(
      client.requests[0]?.params?.getQueryString() ?? '',
    );
    expect(s).not.toContain('filter[name]');
  });

  it('caps the page at PROJECT_PAGE_SIZE', async () => {
    const client = fakeClient({
      documents: docs([project('p1', 'Alpha')]),
    });
    await loadProjectCandidates(client, 'al');
    const s = decodeURIComponent(
      client.requests[0]?.params?.getQueryString() ?? '',
    );
    expect(s).toContain(`page[limit]=${PROJECT_PAGE_SIZE}`);
  });

  it('returns an outcome with the error message when the read fails', async () => {
    const client = {
      get: vi.fn(async () => {
        throw new Error('boom');
      }),
    };
    const outcome = await loadProjectCandidates(client as never, 'al');
    expect(outcome.rows).toEqual([]);
    expect(outcome.error).toBe('boom');
  });

  it('falls back to the uuid when the name attribute is missing', async () => {
    const client = fakeClient({
      documents: {
        [PATH]: { data: [{ type: 'bb_project--bb_project', id: 'p1' }] },
      },
    });
    const outcome = await loadProjectCandidates(client, 'p');
    expect(outcome.rows).toEqual([{ id: 'p1', name: 'p1' }]);
  });
});
