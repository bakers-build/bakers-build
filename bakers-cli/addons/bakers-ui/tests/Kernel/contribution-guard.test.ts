import { expect, it } from 'vitest';
import { guardContribution } from '../../src/Kernel/contribution-guard.js';
import { messageTree } from '../../src/lib/vnode.js';
import {
  BaseScreen,
  presentation,
  type ScreenContext,
} from '../../src/Screen/screen.js';

const context = { requestDraw() {} } as never;
class Demo extends BaseScreen {
  readonly id = 'ticket.boom';
  present(_context: ScreenContext) {
    return presentation(messageTree(this.id, ['healthy']));
  }
  renderNonInteractive(_context: ScreenContext) {
    return ['healthy'];
  }
}
it.each([
  'present',
  'renderNonInteractive',
  'handleInput',
] as const)('renders a named failure after contributed %s throws', (method) => {
  const screen = new Demo();
  screen[method] = () => {
    throw new Error('boom');
  };
  guardContribution(screen);
  if (method === 'handleInput')
    expect(screen.handleInput('z', context)).toBe(true);
  if (method === 'present') screen.present(context);
  expect(screen.renderNonInteractive(context)).toEqual([
    'ticket.boom failed to render: boom',
  ]);
  expect(() => screen.present(context)).not.toThrow();
});
it('allows the contributed screen to handle its own key', () => {
  const screen = new Demo();
  let handled = '';
  screen.handleInput = (input) => {
    handled = input;
    return true;
  };
  guardContribution(screen);
  expect(screen.handleInput('z', context)).toBe(true);
  expect(handled).toBe('z');
});
