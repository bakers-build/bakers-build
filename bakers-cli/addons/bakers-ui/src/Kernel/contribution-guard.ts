import { messageTree } from '../lib/vnode.js';
import { presentation, type Screen } from '../Screen/screen.js';

/** The kernel wires draw directly to resize and mouse-scroll. A contribution
 * must not freeze or crash the cockpit when one of those dispatches throws. */
export function guardContribution(screen: Screen): void {
  let failure: string | undefined;
  const fail = (error: unknown): string => {
    failure = `${screen.id} failed to render: ${error instanceof Error ? error.message : String(error)}`;
    return failure;
  };
  const present = screen.present.bind(screen);
  const render = screen.renderNonInteractive?.bind(screen);
  const input = screen.handleInput.bind(screen);
  screen.present = (context) => {
    if (!failure) {
      try {
        return present(context);
      } catch (error) {
        fail(error);
      }
    }
    return presentation(messageTree(screen.id, [failure as string]));
  };
  if (render)
    screen.renderNonInteractive = (context) => {
      if (failure) return [failure];
      try {
        return render(context);
      } catch (error) {
        return [fail(error)];
      }
    };
  screen.handleInput = (key, context) => {
    if (failure) return false;
    try {
      return input(key, context);
    } catch (error) {
      fail(error);
      context.requestDraw();
      return true;
    }
  };
}
