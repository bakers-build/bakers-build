import { expect, it } from 'bun:test';
import {
  actionsFor,
  BENCH_ROUTES,
  BENCH_SIZES,
  runPageBenchmark,
  SMOKE_PROTOCOL,
} from '../fixtures/page-benchmark.js';

// The latency protocol's own contract, without a machine-dependent threshold:
// every specified route at both sizes yields a verified ready sample and a
// verified sample for each of its input classes, and the demos write nothing.
it('produces a verified ready and input sample for every route and size', async () => {
  const { samples, writes } = await runPageBenchmark({
    protocol: SMOKE_PROTOCOL,
  });
  expect(samples.length).toBeGreaterThan(0);
  expect(writes).toBe(0);
  for (const sample of samples) {
    expect(BENCH_ROUTES as readonly string[]).toContain(sample.route);
    expect(Number.isFinite(sample.elapsedMs)).toBe(true);
    expect(sample.elapsedMs).toBeGreaterThanOrEqual(0);
  }
  const unverified = samples
    .filter((sample) => !sample.frameVerified)
    .map(
      (sample) =>
        `${sample.route} ${sample.columns}x${sample.rows} ${sample.kind}:${sample.action}`,
    );
  expect(unverified).toEqual([]);
  for (const size of BENCH_SIZES) {
    for (const route of BENCH_ROUTES) {
      const mine = samples.filter(
        (sample) =>
          sample.route === route &&
          sample.columns === size.columns &&
          sample.rows === size.rows,
      );
      expect(mine.some((sample) => sample.kind === 'ready')).toBe(true);
      for (const action of actionsFor(route))
        expect(
          mine.some(
            (sample) => sample.kind === 'input' && sample.action === action,
          ),
        ).toBe(true);
    }
  }
}, 120_000);
