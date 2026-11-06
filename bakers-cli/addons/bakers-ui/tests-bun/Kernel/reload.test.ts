import { describe, expect, it } from 'bun:test';
import type {
  Collection,
  DropshClient,
  RendererServices,
} from '../../src/types.js';
import { bootTui, settle } from '../tui-harness.js';

// BB-285 — the shared reload: the kernel binds `R` for every screen that
// DECLARES `reload`, and says so in the one home spec D1 chose, the footer row.

function countingServices(counter: { ticketReads: number }): RendererServices {
  const collection = (): Collection => {
    const c: Collection = {
      where: () => c,
      sort: () => c,
      page: () => c,
      first: async () => null,
      list: async () => [],
    };
    return c;
  };
  const client: DropshClient = {
    collection,
    get: async (path: string) => {
      if (path === 'user/user') return { data: [{ id: 'u-cw' }] };
      if (path === 'bb_ticket/bb_ticket') counter.ticketReads++;
      return { data: [] };
    },
    update: async () => ({}),
  };
  return {
    client,
    baseUrl: 'https://bakers.example',
    currentUser: 'cw',
  };
}

async function bootMyWork(columns?: number) {
  const counter = { ticketReads: 0 };
  const tui = await bootTui({
    services: countingServices(counter),
    ...(columns === undefined ? {} : { columns }),
  });
  return { tui, counter };
}

/** Quit the way a user does, and wait for the kernel to wind itself up. */
async function quit(tui: Awaited<ReturnType<typeof bootTui>>): Promise<void> {
  tui.mockInput.pressKey('q');
  await tui.running;
  await tui.stop();
}

describe('BB-285 — the shared reload affordance (AC-1, AC-2)', () => {
  it('the footer names `R reload` on a screen that can re-read its data', async () => {
    const { tui } = await bootMyWork();
    expect(tui.frame()).toContain('R:reload');
    await quit(tui);
  });

  it('pressing R re-reads the data', async () => {
    const { tui, counter } = await bootMyWork();
    const before = counter.ticketReads;
    await tui.press('R');
    expect(counter.ticketReads).toBe(before + 1);
    expect(tui.frame()).toContain('R:reload');
    await quit(tui);
  });

  it('the footer keeps the key row while a reload is in flight', async () => {
    const { tui } = await bootMyWork();
    tui.mockInput.pressKey('R');
    // No settle(): the frame composed synchronously on the keypress must already
    // mark busy (spec D4 — the draw() right after reload()). Only the PAINT is
    // pumped, so the assertion still reads the frame that keypress produced.
    await tui.renderOnce();
    expect(tui.frame()).toContain('R:reload');
    expect(tui.frame()).not.toContain('Loading…');
    await settle();
    await tui.renderOnce();
    expect(tui.frame()).toContain('R:reload');
    await quit(tui);
  });

  it('the hint leads the footer, so a 40-column terminal cannot cut it (R1)', async () => {
    const { tui } = await bootMyWork(40);
    expect(tui.frame()).toContain('R:reload');
    await quit(tui);
  });
});

describe('BB-285 — screens without reload show no affordance (AC-3, AC-5)', () => {
  it('the project picker renders no hint and types R as text', async () => {
    const { tui } = await bootMyWork();
    // `r` on My work opens the project-filter modal, which declares no reload.
    await tui.press('r');
    expect(tui.frame()).toContain('Filter by project');

    await tui.press('R');
    expect(tui.frame()).not.toContain('R:reload'); // modal chrome: no hint
    // The character landed in the picker's query, not on a reload.
    expect(tui.frame()).toMatch(/search: R\b/);

    await tui.press('\x1b'); // Esc cancels the picker
    await quit(tui);
  });
});
