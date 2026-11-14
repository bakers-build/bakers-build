import { readFileSync } from 'node:fs';
import { readAddonCapabilities } from '@bakers-build/core';

/** Real addon declarations keep config tests independent of a capability table. */
export const capabilities = await readAddonCapabilities(
  ['config-plan', 'config-check', 'config-validation-ui-addons'].flatMap(
    (name) =>
      readFileSync(new URL(`./${name}.test.ts`, import.meta.url), 'utf8').match(
        /@bakers-build\/addon-[a-z-]+/g,
      ) ?? [],
  ),
  [import.meta.url],
);
