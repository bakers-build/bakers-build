import { describe, expect, it } from 'bun:test';
import { openMachines, text } from '../fixtures/machines.js';
import { settle } from '../tui-harness.js';

/**
 * The Machines root tab: a list that only opens a machine's own detail —
 * no key acts on a row (BAKERS-338). Restart runs lives on the machine
 * detail (`machine-detail.test.ts`).
 */
describe('the Machines screen', () => {
  it('lists machines and Enter opens the machine detail', async () => {
    const tui = await openMachines();
    expect(text(tui)).toContain('Machines');
    expect(text(tui)).toContain('workstation');
    expect(text(tui)).toContain('laptop');

    await tui.press('\r');
    await settle();
    await tui.renderOnce();
    expect(text(tui)).toContain('bakers.build machine — workstation');
    expect(text(tui)).toContain('Overview');
    expect(text(tui)).not.toContain('laptop');

    tui.mockInput.pressKey('q');
    await tui.running;
    await tui.stop();
  });

  it('advertises no row action, and r on a row does nothing', async () => {
    const tui = await openMachines();
    expect(text(tui)).not.toContain('Restart runs');

    await tui.press('r');
    await settle();
    await tui.renderOnce();
    expect(text(tui)).not.toContain('Restart runs');
    expect(text(tui)).toContain('laptop');

    tui.mockInput.pressKey('q');
    await tui.running;
    await tui.stop();
  });
});
