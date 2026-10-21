import { afterEach, beforeEach, expect, it, spyOn } from 'bun:test';
import { RenderableEvents } from '@opentui/core';
import { TicketReactScreen } from '../../src/Entity/ticket/Screen/ticket-react.js';
import { TicketReactMarkdownScreen } from '../../src/Entity/ticket/Screen/ticket-react-markdown.js';
import { register, resetCollector } from '../../src/Extension/store.js';
import { runTicketTui } from '../../src/Kernel/tui-kernel.js';
import type { Collection, RendererServices } from '../../src/types.js';
import { bootTui, settle } from '../tui-harness.js';

beforeEach(() => {
  resetCollector();
  register('test/demos', (api) => {
    api.add(TicketReactScreen);
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

it.each([
  'q',
  '\x03',
])('destroys the demo subtree before its native host on exit %j', async (exitKey) => {
  const events: string[] = [];
  const tui = await bootTui({
    services,
    tui: {
      route: { screen: 'ticket', ticketId: 'ticket-demo', view: 'full' },
    },
  });
  try {
    await tui.press('\x1b[Z');
    await tui.press('\x1b[Z');
    expect(tui.frame()).toContain('Click to count: 0');
    const child = tui.renderer.root.findDescendantById(
      'ticket-statistics-demo-counter',
    );
    const host = tui.renderer.root.findDescendantById('region-body');
    // Assert primitives: renderables contain native pointers, unsafe to diff.
    expect(child !== undefined && host !== undefined).toBe(true);
    child?.once(RenderableEvents.DESTROYED, () =>
      events.push('child destroyed'),
    );
    host?.once(RenderableEvents.DESTROYED, () => events.push('host destroyed'));

    tui.mockInput.pressKey(exitKey);
    await tui.running;
    expect(events).toContain('child destroyed');
    expect(events).toContain('host destroyed');
    expect(events.indexOf('child destroyed')).toBeLessThan(
      events.indexOf('host destroyed'),
    );
    expect(tui.renderer.root.getChildren()).toHaveLength(0);
    await tui.renderOnce();
  } finally {
    tui.mockInput.pressKey('\x03');
    await tui.running;
    await tui.stop();
  }
});

it('opens the demo ticket tab and returns to the ticket content', async () => {
  const tui = await bootTui({
    services,
    tui: {
      route: { screen: 'ticket', ticketId: 'ticket-demo', view: 'full' },
    },
  });
  try {
    expect(tui.frame()).toContain('Demo integration');
    await tui.press('\x1b[Z');
    await tui.press('\x1b[Z');
    expect(tui.frame()).toContain('[Statistics]');
    expect(tui.frame()).toContain('Native screen experiment');
    await tui.press('\t');
    expect(tui.frame()).toContain('[Markdown]');
    await tui.press('\t');
    expect(tui.frame()).toContain('[Overview]');
    expect(tui.frame()).not.toContain('Native screen experiment');
    await tui.press('q');
    await tui.running;
  } finally {
    await tui.stop();
  }
});

it('keeps demo interactions local through resize, dialog dismissal and repeated tab switches', async () => {
  const tui = await bootTui({
    services,
    tui: {
      route: { screen: 'ticket', ticketId: 'ticket-demo', view: 'full' },
    },
  });
  try {
    for (let visit = 0; visit < 4; visit++) {
      await tui.press('\x1b[Z');
      await tui.press('\x1b[Z');
      expect(tui.frame()).toContain('Click to count: 0');
      await tui.press('\r');
      expect(tui.frame()).toContain('Click to count: 1');
      await tui.press('d');
      expect(tui.frame()).toContain('Native dialog');
      await tui.press('\x1b');
      expect(tui.frame()).toContain('[Statistics]');
      expect(tui.frame()).not.toContain('Native dialog');
      tui.resize(visit % 2 ? 100 : 80, 30);
      await settle();
      await tui.renderOnce();
      expect(tui.frame()).toContain('Click to count: 1');
      const row = tui
        .rows()
        .findIndex((line) => line.includes('Click to count'));
      await tui.mockMouse.click(5, row);
      await settle();
      await tui.renderOnce();
      expect(tui.frame()).toContain('Click to count: 2');
      const tabs = tui
        .rows()
        .findIndex((line) => line.includes('[Statistics]'));
      await tui.mockMouse.click(5, tabs);
      await settle();
      await tui.renderOnce();
      expect(tui.frame()).toContain('[Overview]');
    }
    await tui.press('\x1b[Z');
    await tui.press('\x1b[Z');
    await tui.press('\x03');
    await tui.running;
    expect(tui.renderer.root.getChildren()).toHaveLength(0);
  } finally {
    await tui.stop();
  }
});

it('prints the contributed demo report without creating an interactive terminal', async () => {
  const output = spyOn(process.stdout, 'write').mockImplementation(() => true);
  try {
    await runTicketTui({}, {}, services, {
      route: { screen: 'ticket', ticketId: 'ticket-demo', view: 'full' },
    });
    const report = output.mock.calls.map((args) => String(args[0])).join('');
    expect(report).toContain('Demo integration');
    expect(report).toContain('Actual ticket **description** for the preview.');
    expect(report).toContain(
      'Statistics demo: interactive controls are available in the terminal.',
    );
    expect(report).not.toContain('\x1b[');
  } finally {
    output.mockRestore();
  }
});

it('shows the productive statistics figures and updates scenarios across terminal sizes', async () => {
  const tui = await bootTui({
    services,
    columns: 120,
    rows: 55,
    tui: {
      route: { screen: 'ticket', ticketId: 'ticket-demo', view: 'full' },
    },
  });
  try {
    await tui.press('\x1b[Z');
    await tui.press('\x1b[Z');
    expect(tui.frame()).toContain('Example data');
    expect(tui.frame()).toContain('Steady week');
    expect(tui.frame()).toContain('Tickets by state');
    expect(tui.frame()).toContain('Share by state');
    expect(tui.frame()).toContain('26 (53.1%)');
    expect(tui.rows().find((line) => line.includes('Done  '))).toMatch(
      /Done\s+26/,
    );
    // The removed demo-only widgets are not rebuilt.
    expect(tui.frame()).not.toContain('Sprint progress');
    expect(tui.frame()).not.toContain('Budget used');
    for (let step = 0; step < 40; step++)
      await tui.mockMouse.scroll(10, 20, 'down', { delayMs: 0 });
    await settle();
    await tui.renderOnce();
    expect(tui.frame()).toContain('Completed per day');
    expect(tui.frame()).toContain('●');
    expect(tui.frame()).toContain('Mon');
    expect(tui.frame()).toContain('Sun');
    await tui.press('n');
    expect(tui.frame()).toContain('Completed 18');
    tui.resize(64, 65);
    await settle();
    await tui.renderOnce();
    for (let step = 0; step < 40; step++)
      await tui.mockMouse.scroll(10, 20, 'up', { delayMs: 0 });
    await settle();
    await tui.renderOnce();
    expect(tui.frame()).toContain('Busy week');
    expect(tui.frame()).toContain('Tickets by state');
    expect(tui.frame()).toContain('42');
    await tui.press('n');
    expect(tui.frame()).toContain('Empty project');
    expect(tui.frame()).toContain('No example values for this scenario.');
    tui.resize(100, 55);
    await settle();
    await tui.renderOnce();
    await tui.press('\t');
    expect(tui.frame()).toContain('[Markdown]');
    await tui.press('\t');
    expect(tui.frame()).toContain('[Overview]');
    await tui.press('q');
    await tui.running;
  } finally {
    await tui.stop();
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
