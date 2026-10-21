import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@bakers-build/addon-fake': new URL(
        './addons/fake/src/index.ts',
        import.meta.url,
      ).pathname,
    },
  },
  test: {
    include: [
      'core/tests/**/*.test.ts',
      'host/tests/**/*.test.ts',
      'conductor/tests/**/*.test.ts',
      'message/tests/**/*.test.ts',
      'ui/tests/**/*.test.ts',
      'addons/*/tests/**/*.test.ts',
    ],
    exclude: [
      // BB-326: `exclude` REPLACES vitest's defaults, of which
      // `**/node_modules/**` is one — so naming any exclusion here silently
      // switched dependency test files back on. It only became visible when the
      // real-PTY harness installed `node-pty` (which ships four `.test.ts`
      // files) under `addons/bakers-ui/tests/pty/node_modules`, right inside the
      // `addons/*/tests/**` include.
      '**/node_modules/**',
      'conductor/tests/integration/**/*.test.ts',
    ],
    environment: 'node',
    reporters: process.env.CI
      ? ['default', ['junit', { outputFile: './junit-vitest.xml' }]]
      : ['default'],
  },
});
