import { describe, expect, it, vi } from 'vitest';
import {
  AmbiguousProjectNameError,
  resolveProject,
} from '../../../../src/Entity/project/Data/project.js';

function fakeProjectCollection(rows: Array<Record<string, unknown>>) {
  const list = vi.fn(async () =>
    rows.map((row) => ({
      id: row.id,
      attr: (name: string) => row[name],
    })),
  );
  const page = vi.fn(() => ({ list }));
  const where = vi.fn(() => ({ page }));
  return { where, page, list };
}

describe('resolveProject', () => {
  it('performs only the project identity lookup', async () => {
    const col = fakeProjectCollection([{ id: 'project-1', name: 'Bb' }]);
    const collection = vi.fn((type: string) => {
      if (type !== 'bb_project') throw new Error(`unexpected ${type} read`);
      return col;
    });

    await expect(
      resolveProject({ collection } as never, 'bakers'),
    ).resolves.toEqual({
      id: 'project-1',
      name: 'Bb',
      slug: 'bakers',
    });
    expect(collection).toHaveBeenCalledTimes(1);
    expect(col.where).toHaveBeenCalledWith('name', '=', 'bakers');
    expect(col.page).toHaveBeenCalledWith(2);
    expect(col.list).toHaveBeenCalledTimes(1);
  });

  it('falls back to the slug when no project matches', async () => {
    const col = fakeProjectCollection([]);
    const collection = vi.fn(() => col);

    await expect(
      resolveProject({ collection } as never, 'bakers'),
    ).resolves.toEqual({
      id: 'bakers',
      name: 'bakers',
      slug: 'bakers',
    });
  });

  // BB-472: bb_project.name carries no uniqueness constraint, so a plain
  // `.first()` was an arbitrary pick with no error and no log line.
  it('throws AmbiguousProjectNameError when two projects share a name', async () => {
    const col = fakeProjectCollection([
      { id: 'project-1', name: 'Bb' },
      { id: 'project-2', name: 'Bb' },
    ]);
    const collection = vi.fn(() => col);

    await expect(
      resolveProject({ collection } as never, 'bakers'),
    ).rejects.toBeInstanceOf(AmbiguousProjectNameError);
    await expect(
      resolveProject({ collection } as never, 'bakers'),
    ).rejects.toThrow(/project "bakers" is ambiguous.*2/i);
  });
});
