/**
 * Page latency capture for the ten specified TUI routes. Not a unit test.
 *
 *   bun tests-bun/fixtures/measure-ticket-detail.ts --all-pages --out <json>
 *   bun tests-bun/fixtures/measure-ticket-detail.ts --all-pages --smoke --out <json>
 *
 * One invocation is one leg on one revision. Interleave baseline and candidate
 * invocations on the same machine; `--label` names the leg in the output.
 * `--smoke` runs every case once without timing thresholds.
 */

import { writeFileSync } from 'node:fs';
import { arch, cpus, release, type } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureSize } from './long-ticket.js';
import {
  BENCH_ROUTES,
  BENCH_SIZES,
  FIXED_NOW_SECONDS,
  FULL_PROTOCOL,
  runPageBenchmark,
  SMOKE_PROTOCOL,
  summarize,
} from './page-benchmark.js';

const argument = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

if (!process.argv.includes('--all-pages')) {
  process.stderr.write(
    'usage: --all-pages [--smoke] [--label <leg>] --out <json>\n',
  );
  process.exit(2);
}
const out = argument('--out');
if (out === undefined) {
  process.stderr.write('--out <json> is required\n');
  process.exit(2);
}

const smoke = process.argv.includes('--smoke');
const protocol = smoke ? SMOKE_PROTOCOL : FULL_PROTOCOL;
const here = dirname(fileURLToPath(import.meta.url));
const git = (...args: string[]) =>
  Bun.spawnSync(['git', ...args], { cwd: here })
    .stdout.toString()
    .trim();
const pkg = JSON.parse(
  await Bun.file(join(here, '../../package.json')).text(),
) as { dependencies: Record<string, string> };

const started = performance.now();
const result = await runPageBenchmark({ protocol });
const report = {
  label: argument('--label') ?? 'unlabelled',
  commit: git('rev-parse', 'HEAD'),
  dirty: git('status', '--porcelain', '--', '.') !== '',
  os: `${type()} ${release()} ${arch()}`,
  cpu: cpus()[0]?.model ?? 'unknown',
  bun: Bun.version,
  opentui: pkg.dependencies['@opentui/core'],
  react: pkg.dependencies.react ?? null,
  protocol: {
    ...protocol,
    routes: BENCH_ROUTES,
    sizes: BENCH_SIZES,
    fixedNowSeconds: FIXED_NOW_SECONDS,
    fixture: fixtureSize,
  },
  writes: result.writes,
  durationMs: performance.now() - started,
  summary: summarize(result.samples),
  samples: result.samples,
  sampledAt: new Date().toISOString(),
};
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${out}\n`);
process.exit(0);
