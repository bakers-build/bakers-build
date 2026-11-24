import { describe, expect, it } from 'bun:test';
import { openMachines, text } from '../fixtures/machines.js';
import { settle } from '../tui-harness.js';

/**
 * The machine detail scope (BAKERS-338): Overview carries Restart runs for
 * the machine's owner, and the Conductors tab lists that machine's
 * conductors, each opening its own detail.
 */
async function openWorkstation(owner?: string) {
  const tui = await openMachines(owner);
  await tui.press('\r');
  await settle();
  await tui.renderOnce();
  return tui;
}

async function quit(tui: Awaited<ReturnType<typeof openMachines>>) {
  tui.mockInput.pressKey('q');
  await tui.running;
  await tui.stop();
}

describe('the machine detail', () => {
  it('shows the machine on its Overview', async () => {
    const tui = await openWorkstation();
    expect(text(tui)).toContain('Status: online');
    expect(text(tui)).toContain('Conductors: 1');
    await quit(tui);
  });

  it('r on an owned machine opens Restart runs; Esc writes nothing', async () => {
    const tui = await openWorkstation();
    expect(text(tui)).toContain('r:Restart runs');

    await tui.press('r');
    await settle();
    await tui.renderOnce();
    expect(text(tui)).toContain('No runs to restart on machine workstation');

    await tui.press('\x1b');
    await settle();
    await tui.renderOnce();
    expect(tui.writes).toEqual([]);
    expect(text(tui)).toContain('bakers.build machine — workstation');

    await quit(tui);
  });

  it('offers no Restart runs on a machine someone else owns', async () => {
    const tui = await openWorkstation('someone-else');
    expect(text(tui)).toContain('bakers.build machine — workstation');
    expect(text(tui)).not.toContain('Restart runs');

    await tui.press('r');
    await settle();
    await tui.renderOnce();
    expect(text(tui)).not.toContain('Restart runs');

    await quit(tui);
  });

  it("lists the machine's conductors on its Conductors tab; Enter opens one", async () => {
    const tui = await openWorkstation();
    await tui.press('\t');
    await settle();
    await tui.renderOnce();
    expect(text(tui)).toContain('north conductor');
    expect(text(tui)).not.toContain('south conductor');

    await tui.press('\r');
    await settle();
    await tui.renderOnce();
    expect(text(tui)).toContain('bakers.build conductor — north conductor');

    await quit(tui);
  });
});
