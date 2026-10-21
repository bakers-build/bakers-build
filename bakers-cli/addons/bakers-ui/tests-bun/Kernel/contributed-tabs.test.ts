import { expect, it } from 'bun:test';
import { register, resetCollector } from '../../src/Extension/store.js';
import { textNode } from '../../src/lib/vnode.js';
import type { RouteMetadata } from '../../src/Routing/route.js';
import { AsyncScreen } from '../../src/Screen/async-screen.js';
import type { Collection, RendererServices } from '../../src/types.js';
import { bootTui, settle } from '../tui-harness.js';

class ReportsScreen extends AsyncScreen<string> {
  static readonly route: RouteMetadata = {
    id: 'root.reports',
    path: '/reports',
    tab: { id: 'reports', label: 'Reports', scope: 'root', weight: 15 },
  };
  readonly id = 'root.reports';
  protected load() {
    return Promise.resolve('Contributed report body');
  }
  protected renderLoading() {
    return ['Loading reports'];
  }
  protected renderReady(data: string) {
    return textNode({ id: 'report-content', content: data });
  }
  protected chrome() {
    return { title: 'Reports screen' };
  }
}
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
  client: {
    collection,
    get: async () => ({ data: [] }),
    update: async () => ({}),
  },
};

it('uses a contributed root screen for Tab, Shift+Tab and mouse navigation', async () => {
  resetCollector();
  register('test/reports', (api) => api.add(ReportsScreen));
  const tui = await bootTui({ services });
  try {
    expect(tui.frame()).toContain('My work   [Stats]   Reports    Projects');
    await tui.press('\t');
    expect(tui.frame()).toContain('[Reports]');
    expect(tui.frame()).toContain('Contributed report body');
    await tui.press('\t');
    expect(tui.frame()).toContain('[Projects]');
    await tui.press('\x1b[Z');
    expect(tui.frame()).toContain('[Reports]');
    await tui.press('\x1b[Z');
    expect(tui.frame()).toContain('[Stats]');
    const row = tui
      .rows()
      .findIndex((line) => line.includes('[Stats]   Reports'));
    expect(row).toBeGreaterThanOrEqual(0);
    const column = (tui.rows()[row] ?? '').indexOf('Reports');
    expect(column).toBeGreaterThanOrEqual(0);
    await tui.mockMouse.click(column, row);
    await settle();
    await tui.renderOnce();
    expect(tui.frame()).toContain('[Reports]');
    expect(tui.frame()).toContain('Contributed report body');
    await tui.press('q');
    await tui.running;
  } finally {
    await tui.stop();
    resetCollector();
  }
});
