import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('session presentation boundary', () => {
  it('consumes the active routed screen presentation for Runs', () => {
    const source = readFileSync(
      new URL('../../src/Kernel/tui-kernel.ts', import.meta.url),
      'utf8',
    );
    expect(source).toContain('active()?.present(context())');
    expect(source).toContain('active()?.handleInput(key, context())');
  });

  it('delegates destination activation without a concrete screen decision table', () => {
    const source = readFileSync(
      new URL('../../src/Kernel/tui-kernel.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toContain('const activateSelected = async');
    expect(source).toMatch(
      /active\(\)\?\.activate\?\.\(shown\?\.selectedIndex \?\? 0, context\(\)\)/,
    );
    expect(source).not.toContain('configureActivation');
    expect(source).not.toContain('let activeTab');
    expect(source).not.toContain('let selectedEntry');
    expect(source).not.toContain('expandedByTab');
    expect(source).not.toContain('runDetailId');
  });

  it('has one presentation path for body, header and status', () => {
    const kernel = readFileSync(
      new URL('../../src/Kernel/tui-kernel.ts', import.meta.url),
      'utf8',
    );
    // BB-326: the kernel still reads the ONE presentation, but the header and
    // status defaults it used to build inline now live in the composition — the
    // composition moved out of the file that writes to the terminal. The guard
    // follows them rather than weakening: there is still exactly one home for
    // each, and still no per-screen decision table in either file.
    //
    // BB-340 Task 4: that home is `Kernel/chrome.ts`, which composes the same
    // two defaults over its own `ChromeInput` now that `Kernel/frame.ts` is gone.
    const chrome = readFileSync(
      new URL('../../src/Kernel/chrome.ts', import.meta.url),
      'utf8',
    );
    expect(kernel).toContain('const shown = active()?.present(context())');
    expect(chrome).toContain('input.header ??');
    // BB-375 — kernel owns the footer key row; status is an optional notice.
    expect(chrome).toContain('footerNotice');
    expect(chrome).toContain('footerKey');
    expect(chrome).toContain('Esc');
    expect(chrome).toContain(':back');
    expect(kernel).not.toContain("if (screen === 'ticket') {");
    expect(chrome).not.toContain("if (screen === 'ticket') {");
  });
});
