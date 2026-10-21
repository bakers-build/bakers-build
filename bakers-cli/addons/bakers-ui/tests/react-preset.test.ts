import { discoverAddons } from '@bakers-build/core';
import { expect, it } from 'vitest';

it('discovers the React ticket entry only when explicitly enabled', async () => {
  const bases = [new URL('../../../host/package.json', import.meta.url).href];
  const disabled = await discoverAddons(
    ['@bakers-build/addon-bakers-ui'],
    'connection',
    bases,
  );
  expect(disabled.uiEntries).toEqual([]);
  const enabled = await discoverAddons(
    ['@bakers-build/addon-bakers-ui/react-experiment'],
    'connection',
    bases,
  );
  expect(enabled.uiEntries).toEqual([
    '@bakers-build/addon-bakers-ui/react-experiment',
  ]);
});
