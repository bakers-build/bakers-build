import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['conductor/tests/integration/**/*.test.ts'],
    environment: 'node',
    reporters: process.env.CI
      ? [
          'default',
          [
            'junit',
            { outputFile: '../tests/artifacts/bakers/junit-integration.xml' },
          ],
        ]
      : ['default'],
    testTimeout: 60_000,
    pool: 'forks',
    // Integration files run STRICTLY one at a time. `herdr-test-server.ts`
    // relies on it: it redirects the process's own `HERDR_SOCKET_PATH` and
    // restores it in `afterAll`, which is only safe while no second file runs
    // concurrently in the same process.
    // Vitest 4 removed `poolOptions` (and `singleFork` with it) — it is ignored
    // with a deprecation warning, so the pin below is the whole guarantee.
    fileParallelism: false,
    maxWorkers: 1,
  },
});
