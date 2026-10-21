import { beforeEach, expect, it, vi } from 'vitest';
import { loadContributions } from '../../src/Extension/load.js';
import { register, resetCollector } from '../../src/Extension/store.js';
import { messageTree } from '../../src/lib/vnode.js';
import { BaseScreen, presentation } from '../../src/Screen/screen.js';

beforeEach(() => resetCollector());

it('imports each entry once, then drains into a class list', async () => {
  const importer = vi.fn(async (specifier: string) => {
    class Contributed extends BaseScreen {
      readonly id = specifier;
      present() {
        return presentation(messageTree(this.id, [specifier]));
      }
      static readonly route = {
        id: specifier,
        path: `/tickets/:ticketId/${specifier}`,
        tab: { id: specifier, label: specifier, scope: 'ticket', weight: 1 },
      };
    }
    register(specifier, (api) => api.add(Contributed));
  });

  const query = await loadContributions(['a', 'b'], importer);

  expect(importer).toHaveBeenCalledTimes(2);
  expect(query.map((p) => p.route.id)).toEqual(['a', 'b']);
});

it('names the specifier when an entry cannot be loaded', async () => {
  await expect(
    loadContributions(['@acme/broken'], async () => {
      throw new Error('boom');
    }),
  ).rejects.toThrow(/@acme\/broken/);
});

it('is an empty list when there are no entries', async () => {
  const query = await loadContributions([]);
  expect(query).toEqual([]);
});
