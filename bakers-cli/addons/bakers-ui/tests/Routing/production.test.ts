import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('production routing composition', () => {
  it('keeps concrete screens below their owning Entity', () => {
    const sharedScreenModules = readdirSync(
      new URL('../../src/Screen/', import.meta.url),
    ).sort();
    // BB-292 (re-entry) widens this whitelist by exactly one entry: `ListScreen`
    // moved out of `async-screen.ts` into its own module. BB-294 had put it in
    // `async-screen.ts` BECAUSE of this list; keeping it there is what made the
    // list builder unfindable, so the list moves rather than the class. Still an
    // exact whitelist, not a `toContain` — a new shared screen module, or a
    // directory, still has to be argued here.
    expect(sharedScreenModules).toEqual([
      'async-modal-screen.ts',
      'async-screen.ts',
      'full-screen.ts',
      'list-screen.ts',
      'modal-screen.ts',
      // Shared async row-action helper, not a concrete screen — same kind of
      // argued whitelist entry as list-screen.ts.
      'row-action.ts',
      'screen.ts',
    ]);

    const registry = readFileSync(
      new URL('../../src/Routing/routes.ts', import.meta.url),
      'utf8',
    );
    expect(registry).not.toContain("from '../Screen/");
    expect(registry).toContain("from '../Entity/");
  });

  it('constructs the Router from the explicit route registry', () => {
    const source = readFileSync(
      new URL('../../src/Kernel/tui-kernel.ts', import.meta.url),
      'utf8',
    );
    // Contributions drain before the registry is built; the explicit built-in
    // list remains reviewable, and the kernel must use that resulting registry.
    expect(source).toContain(
      'const routes = buildRoutes(contributed, options.isWorkspaceAdmin ?? false)',
    );
    expect(source).toContain(
      'const session = routes.createSession(environment)',
    );
    expect(source).toMatch(/new Router\(\s*session\.screens\(\)/);
  });

  it('routes every project tab without legacy tab openers', () => {
    const source = readFileSync(
      new URL('../../src/Kernel/tui-kernel.ts', import.meta.url),
      'utf8',
    );
    expect(source).toContain('router.navigateTab(here.level, target.id)');
    expect(source).not.toContain('const openRunsScreen');
    expect(source).not.toContain('const openAgentsScreen');
    expect(source).not.toContain('const loadProjectTickets');
    expect(source).not.toContain('const openProjects');
    expect(source).not.toContain('const openTicketById');
    expect(source).not.toContain('const openSelectedDetail');
    expect(source).not.toContain('const openRunScreen');
  });

  it('contains no runtime concrete-screen comparisons beyond boot parsing', () => {
    const source = readFileSync(
      new URL('../../src/Kernel/tui-kernel.ts', import.meta.url),
      'utf8',
    );
    const runtime = source.slice(source.indexOf('const screenRouter ='));
    const withoutBootParser = runtime
      .replace(/const bootFromRoute[\s\S]*?\n {2}};\n/, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(withoutBootParser).not.toMatch(/\bscreen\s*[!=]==?\s*['"]/);
    expect(withoutBootParser).not.toMatch(
      /screenRouter\.active\?\.id\s*[!=]==?/,
    );
    expect(withoutBootParser).not.toMatch(
      /(?:switch\s*\(\s*screen\s*\)|Record<\s*Screen\s*,)/,
    );
  });
});
