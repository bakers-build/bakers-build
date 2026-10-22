import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/**
 * BB-326 — `@opentui/core` reaches its Zig core through FFI, which Node does
 * not expose before 26.1 (and then only behind `--experimental-ffi`). So the
 * cockpit runs under the `bun` that `@bakers-build/addon-bakers-ui` installs.
 *
 * `process.versions.bun` is the loop guard: it is defined under Bun and nowhere
 * else, so a re-exec can never recurse and no sentinel variable is introduced.
 * `--print-config` deliberately stays on Node — it is what a human runs when the
 * cockpit will not start, and a diagnostic that needs the thing it diagnoses is
 * worth nothing.
 *
 * `injectedRenderer` is the same argument one step further: the runtime is
 * needed by the DYNAMICALLY-resolved `@bakers-build/addon-bakers-ui`, so a caller that
 * supplies its own `runUi` never reaches OpenTUI and must not be re-execed.
 */
export function shouldReExecUnderBun(input: {
  bunVersion?: string | undefined;
  noBun?: string | undefined;
  printConfig: boolean;
  injectedRenderer?: boolean | undefined;
}): boolean {
  if (input.printConfig) return false;
  if (input.injectedRenderer) return false;
  if (input.bunVersion !== undefined) return false;
  if (input.noBun !== undefined && input.noBun !== '') return false;
  return true;
}

/**
 * Resolve the `bun` executable from the renderer addon's own base — the same
 * dynamic seam `loadBbUiModule` resolves the renderer through, so the one
 * dynamic edge in this package stays one edge.
 *
 * The manifest is read with a plain `readFileSync` rather than through the
 * resolver: `createRequire(...).resolve()` gives an absolute path, and reading a
 * known path needs no module system. `bun`'s manifest is resolved by name
 * (`bun/package.json`) because the launcher's location is the thing we are
 * looking up; its `bin` entry is a relative path from the manifest's directory.
 */
export function resolveBunBinary(bases: string[]): string | undefined {
  for (const base of bases) {
    try {
      const addon = createRequire(base).resolve(
        '@bakers-build/addon-bakers-ui',
      );
      const manifest = createRequire(addon).resolve('bun/package.json');
      const { bin } = JSON.parse(readFileSync(manifest, 'utf8')) as {
        bin?: Record<string, string> | string;
      };
      const relative = typeof bin === 'string' ? bin : bin?.bun;
      if (relative) return join(dirname(manifest), relative);
    } catch {
      // try the next base
    }
  }
  return undefined;
}

export type LibcFamily = 'glibc' | 'musl' | 'unknown';

/**
 * The dynamic linker musl installs. Matched as a path segment ending in `.so`
 * rather than a bare `includes('ld-musl')`, so an unrelated mapped file whose
 * NAME happens to carry the string cannot be mistaken for the interpreter.
 */
const MUSL_INTERPRETER = /\/ld-musl-[^/\s]*\.so/;

/**
 * BB-326 (A1) — which C library is this host running?
 *
 * Two evidence sources, cheapest first, both injected so the answer never
 * depends on the machine the test runs on:
 *
 *  - `/proc/self/maps` (~0.1 ms) names the interpreter the kernel ACTUALLY
 *    mapped into this process. That is the strongest signal available: a glibc
 *    box with a musl-compat package installed has `/lib/ld-musl-x86_64.so.1` on
 *    disk but never maps it, so the `existsSync` shortcut would misread it.
 *  - the node report's `header.glibcVersionRuntime` (~4.6 ms) — present on
 *    glibc, absent on musl. It needs no filesystem, which is why it is the
 *    fallback for a container that hides `/proc`. Verified on all four
 *    combinations: node+glibc `"2.43"`, bun+glibc `"2.43"`, node+musl absent,
 *    bun+musl absent (node:22-alpine).
 *
 * Non-Linux returns `unknown` and NOT `musl`: the report header omits
 * `glibcVersionRuntime` on macOS and Windows too, so reading its absence as
 * musl would mislabel every mac. musl is a Linux question.
 *
 * Inconclusive is `unknown`, and `unknown` changes nothing — glibc is upstream's
 * default and the overwhelmingly common case, so a failed probe must degrade to
 * today's behaviour rather than to a guess.
 */
export function detectLibcFamily(probe: {
  platform: string;
  readProcSelfMaps: () => string | undefined;
  readReportLibc: () => LibcFamily;
}): LibcFamily {
  if (probe.platform !== 'linux') return 'unknown';
  const maps = probe.readProcSelfMaps();
  if (maps !== undefined) return MUSL_INTERPRETER.test(maps) ? 'musl' : 'glibc';
  return probe.readReportLibc();
}

/** The real probe. Every leg is wrapped: an inconclusive read must not throw. */
export function nodeLibcFamily(): LibcFamily {
  return detectLibcFamily({
    platform: process.platform,
    readProcSelfMaps: () => {
      try {
        return readFileSync('/proc/self/maps', 'utf8');
      } catch {
        return undefined;
      }
    },
    readReportLibc: () => {
      try {
        const report = process.report.getReport() as {
          header?: { glibcVersionRuntime?: string };
        };
        return report.header?.glibcVersionRuntime ? 'glibc' : 'musl';
      } catch {
        return 'unknown';
      }
    },
  });
}

/**
 * BB-326 (A1) — make the cockpit start on musl with no manual step.
 *
 * `@opentui/core@0.5.1` selects its native platform package from
 * `process.env.OPENTUI_LIBC` and DEFAULTS TO GLIBC — it runs no probe of its
 * own. Both prebuilts are always on disk (npm and pnpm filter optional deps by
 * `os`/`cpu`, never by libc), so on Alpine the wrong one loads and the first
 * frame dies with `Error loading shared library ld-linux-x86-64.so.2 (needed by
 * libopentui.so)`. Requiring the user to export the variable IS a manual step,
 * so A1 is only met once we set it.
 *
 * An explicit value always wins: an operator who exports `OPENTUI_LIBC=glibc`
 * on a musl box is doing something deliberate, and a probe must not overrule
 * them. Because a set value short-circuits BEFORE `detect` is called, the Bun
 * child — which inherits this env — never pays for the probe a second time.
 */
export function applyOpentuiLibc(
  env: NodeJS.ProcessEnv,
  detect: () => LibcFamily = nodeLibcFamily,
): void {
  const current = env.OPENTUI_LIBC;
  if (current !== undefined && current !== '') return;
  if (detect() === 'musl') env.OPENTUI_LIBC = 'musl';
}

/** Replace this process with the same command under Bun. Never returns. */
export function reExecUnderBun(bin: string, argv: string[]): never {
  const result = spawnSync(bin, argv.slice(1), {
    stdio: 'inherit',
    env: process.env,
  });
  process.exit(result.status ?? 1);
}
