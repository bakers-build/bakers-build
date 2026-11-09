import { afterEach, beforeEach, expect, it, spyOn } from 'bun:test';
import { TicketReactMarkdownScreen } from '../../src/Entity/ticket/Screen/ticket-react-markdown.js';
import { register, resetCollector } from '../../src/Extension/store.js';
import { runTicketTui } from '../../src/Kernel/tui-kernel.js';
import type { Collection, RendererServices } from '../../src/types.js';
import { bootTui, settle } from '../tui-harness.js';

beforeEach(() => {
  resetCollector();
  register('test/demos', (api) => {
    api.add(TicketReactMarkdownScreen);
  });
});
afterEach(() => resetCollector());

const document = {
  data: {
    type: 'bb_ticket--bb_ticket',
    id: 'ticket-demo',
    attributes: {
      identifier: 'TEST-1',
      title: 'Demo integration',
      state: 'coding',
      description: { value: 'Actual ticket **description** for the preview.' },
    },
  },
};
const collection = (): Collection => {
  const result: Collection = {
    where: () => result,
    sort: () => result,
    page: () => result,
    first: async () => null,
    list: async () => [],
  };
  return result;
};
const services: RendererServices = {
  baseUrl: 'https://example.test',
  currentUser: 'tester',
  client: { collection, get: async () => document, update: async () => ({}) },
};

it('prints the contributed demo report without creating an interactive terminal', async () => {
  const output = spyOn(process.stdout, 'write').mockImplementation(() => true);
  try {
    await runTicketTui({}, {}, services, {
      route: { screen: 'ticket', ticketId: 'ticket-demo', view: 'full' },
    });
    const report = output.mock.calls.map((args) => String(args[0])).join('');
    expect(report).toContain('Demo integration');
    expect(report).toContain('Actual ticket **description** for the preview.');
    expect(report).not.toContain('\x1b[');
  } finally {
    output.mockRestore();
  }
});

it('scrolls the Markdown document while retaining native ticket chrome', async () => {
  const tui = await bootTui({
    services,
    columns: 140,
    rows: 40,
    tui: {
      route: { screen: 'ticket', ticketId: 'ticket-demo', view: 'full' },
    },
  });
  try {
    await tui.press('\x1b[Z');
    expect(tui.frame()).toContain('[Markdown]');
    expect(tui.frame()).toContain('Ticket description');
    expect(tui.frame()).toContain('Actual ticket description for the preview.');
    expect(tui.frame()).toContain('const screen = "NativeScreen";');
    expect(tui.frame()).not.toContain('End of Markdown example');
    for (let step = 0; step < 240; step++) tui.mockInput.pressKey('\x1b[B');
    await settle();
    await tui.renderOnce();
    expect(tui.frame()).toContain('End of Markdown example');
    expect(tui.frame()).toContain('TEST-1');
    expect(tui.frame()).toContain('[Markdown]');
    expect(tui.frame()).not.toContain('Ticket description');
    for (let step = 0; step < 260; step++)
      await tui.mockMouse.scroll(10, 15, 'up', { delayMs: 0 });
    await settle();
    await tui.renderOnce();
    expect(tui.frame()).toContain('Ticket description');
    expect(tui.frame()).toContain('Actual ticket description for the preview.');
    tui.resize(54, 30);
    await settle();
    await tui.renderOnce();
    expect(tui.frame()).toContain('Example document');
    await tui.press('\t');
    expect(tui.frame()).toContain('[Overview]');
    await tui.press('q');
    await tui.running;
  } finally {
    await tui.stop();
  }
});
