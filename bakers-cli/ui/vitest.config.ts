import { defineConfig } from 'vitest/config';

// BB-219: `@bakers-build/ui`'s own test gate. The workspace-root config's include
// list is shared by every package, and a positional filter cannot separate
// `ui/tests` from `addons/bakers-ui/tests` (substring match, no anchoring), so
// this package scopes its own run. `pnpm --filter @bakers-build/ui test` therefore
// runs exactly this package's tests — the CI suite still runs all of them from
// the root config.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
