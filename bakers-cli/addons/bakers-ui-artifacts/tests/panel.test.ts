import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { ArtifactsTabScreen } from '../src/panel.js';

const doc = {
  data: {
    type: 'bb_ticket--bb_ticket',
    id: 't1',
    attributes: {
      identifier: 'BB-373',
      branch_name: 'feat/bb-373-x',
    },
  },
};

const ctx = {
  requestDraw: () => {},
  isActive: () => true,
  sessionGeneration: 1,
  params: { ticketId: 't1' },
  options: { cwd: '/nope' },
};
async function opened(cwd?: string) {
  const screen = new ArtifactsTabScreen();
  const context = {
    ...ctx,
    options: { cwd },
    contexts: {
      has: () => true,
      get: () => ({ document: doc }),
      scopeKey: () => 't1',
    },
  };
  screen.enter(context as never);
  await Promise.resolve();
  return { screen, context };
}
it('names both probed roots when there is no tree', async () => {
  const { screen, context } = await opened('/nope');
  expect(screen.renderNonInteractive(context as never).join('\n')).toContain(
    '/nope/assets-ai/BB-373',
  );
  expect(screen.renderNonInteractive(context as never).join('\n')).toContain(
    '/nope/.bakers-worktrees/feat/bb-373-x/assets-ai/BB-373',
  );
});
it('says so when the cockpit has no cwd at all', async () => {
  const { screen, context } = await opened();
  expect(screen.renderNonInteractive(context as never).join('\n')).toContain(
    'This cockpit has no checkout to read artifacts from.',
  );
});
it('lists local artifacts and expands their content', async () => {
  const root = join(tmpdir(), `bb-373-panel-${process.pid}-${Math.random()}`);
  mkdirSync(join(root, 'assets-ai', 'BB-373', 'vitest'), { recursive: true });
  writeFileSync(
    join(root, 'assets-ai', 'BB-373', 'vitest', 'store-green.txt'),
    'pnpm vitest run addons/bakers-ui/tests\n\n12 passed\n',
  );
  const { screen, context } = await opened(root);
  expect(screen.renderNonInteractive(context as never).join('\n')).toContain(
    'vitest/store-green.txt',
  );
  expect(
    screen.renderNonInteractive(context as never).join('\n'),
  ).not.toContain('12 passed');
  expect(screen.handleInput('enter', context as never)).toBe(true);
  expect(screen.present(context as never).selectable).toBe(1);
});
it('retains panel copy keys without reading the control plane', async () => {
  const { screen, context } = await opened('/nope');
  expect(screen.handleInput('y', context as never)).toBe(true);
  expect(screen.handleInput('Y', context as never)).toBe(true);
  expect(
    screen
      .present(context as never)
      .actions?.map((a) => `${a.key} ${a.label}`)
      .join(' · '),
  ).toBe('Tab section · e edit · y copy id · Y copy link · ↑↓ scroll');
});
