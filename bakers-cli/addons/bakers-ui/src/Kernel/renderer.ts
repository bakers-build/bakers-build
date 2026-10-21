import {
  BoxRenderable,
  type CliRenderer,
  createCliRenderer,
} from '@opentui/core';
import type { InputTrace } from '../lib/input-trace.js';
import { DEFAULT_BACKGROUND } from '../lib/theme.js';
import type { TuiOptions } from '../types.js';

/**
 * BB-382 — TAKING THE TERMINAL, and nothing else.
 *
 * Lifted out of `tui-kernel.ts` whole. Everything the kernel does after this
 * module returns closes over mutable state — the router, the active screen, the
 * standing trees — and the terminal's bring-up closes over none of it: five
 * values that are already values at the point of the call, in and a renderer
 * plus its surface out. That makes it a FACTORY rather than a step of a
 * sequence, which is why it can live in a file of its own without a parameter
 * bag standing in for the closure.
 *
 * What it owns is one decision with several parts: whether this process gets a
 * renderer at all, whether the anchor bytes are ours to write, which of
 * `@opentui/core`'s defaults the cockpit contradicts and why, and the shell box
 * every region is laid out inside. The rationale for each part travels with it
 * (see `HOME_AND_CLEAR` below and the option comments) because that rationale
 * is the reason the code reads the way it does — several of the options are
 * there to UNDO a default, and a reader who cannot see why would tidy them away.
 */

/**
 * BB-326 — home the cursor and clear the screen, once, before the renderer
 * exists.
 *
 * `screenMode: 'main-screen'` does NOT mean "the top of the terminal". It means
 * "wherever the cursor is": `@opentui/core@0.5.1` probes the cursor position
 * while it sets the terminal up and anchors its render surface on that row,
 * while keeping the surface's full `renderer.height`. So every byte written
 * before `createCliRenderer` — the update notice, the `resolved connection` log,
 * and whatever the operator's shell left on screen — pushes the WHOLE frame down
 * and the same number of rows falls off the bottom, silently clipped. The status
 * footer is the last composed row, so it is the first thing to go: measured at
 * 24 rows of offset on a 40-row pty, the cockpit's footer was not on screen at
 * all (`tests/pty/verify-anchor.mjs`, and the CPR reply `ESC[24;1R` in its
 * transcript names the anchor row).
 *
 * These are the exact bytes the hand-rolled kernel opened EVERY draw with, which
 * is why it could not have this defect. The swap dropped them on the grounds
 * that "replacing the whole row set and letting the renderer diff the cells IS
 * the clear" — true of the surface's CONTENTS, and silent about where the
 * surface begins. Once is enough here because the anchor is captured once, at
 * setup, and the renderer owns every cell of its surface from then on.
 *
 * Deliberately not `screenMode: 'alternate-screen'`, which would also anchor at
 * the top: the cockpit has always painted on the main screen, and moving it to
 * the alternate one changes what the operator's terminal shows after `q`.
 */
const HOME_AND_CLEAR = '\x1b[H\x1b[2J';

/** Everything the bring-up reads — all of it a value before it is called. */
export interface TerminalShellInput {
  readonly options: TuiOptions;
  readonly input: typeof process.stdin;
  readonly output: typeof process.stdout;
  readonly trace: InputTrace | undefined;
  readonly interactive: boolean;
}

/**
 * The terminal, as the kernel holds it.
 *
 * `ownsRenderer` rides along because the ANSWER is made here — an injected
 * renderer belongs to its test — and teardown is the only other place that may
 * act on it. Recomputing it at teardown would be the same condition stated
 * twice, which is how the two come to disagree.
 */
export interface TerminalShell {
  readonly renderer: CliRenderer | undefined;
  readonly shell: BoxRenderable | undefined;
  readonly ownsRenderer: boolean;
}

export async function createTerminalShell({
  options,
  input,
  output,
  trace,
  interactive,
}: TerminalShellInput): Promise<TerminalShell> {
  /**
   * BB-326 — the ONE renderer that owns the terminal.
   *
   * Created before the router, because `draw` closes over it and the router
   * paints on its first `navigate`. Not created at all when the process is
   * non-interactive: that branch writes plain lines to a pipe and never had a
   * renderer to replace.
   */
  const ownsRenderer = interactive && options.renderer === undefined;
  // Strictly before `createCliRenderer`, which is where the anchor is decided.
  // Only for a renderer this kernel MAKES: an injected one has no terminal
  // behind it, and writing control bytes into a test's stream is not this
  // function's business. See `HOME_AND_CLEAR`.
  if (ownsRenderer) output.write(HOME_AND_CLEAR);
  const renderer = interactive
    ? (options.renderer ??
      (await createCliRenderer({
        stdin: input,
        stdout: output,
        // `finish()` owns teardown, and Ctrl+C is a key in the ladder.
        exitOnCtrlC: false,
        useMouse: true,
        // BB-241 AC-9, which the swap would otherwise have broken silently.
        // `@opentui/core@0.5.1` defaults `enableMouseMovement` to TRUE, so
        // `useMouse: true` alone also sets `?1002h` (button-event motion) and
        // `?1003h` (any-event motion). Those two are exactly what take the
        // TERMINAL'S OWN text selection away from the operator: with them on, a
        // click-drag selects nothing and a middle-click paste is swallowed.
        // The hand-rolled kernel set neither, and the cockpit needs neither —
        // it reads presses and wheel notches, never motion.
        // Verified on a real pty by `tests/pty/verify-mouse-modes.mjs`.
        enableMouseMovement: false,
        // The legacy xterm encoding is what `keyEventToKeys`'s equality
        // depends on — under the Kitty protocol the same key arrives with a
        // different encoding and every literal in `Form/keys.ts` stops
        // matching, silently.
        useKittyKeyboard: null,
        // OpenTUI draws an uncaught handler exception into an ON-SCREEN console
        // overlay instead of stderr, which reads as "the screen froze and
        // nothing says why". Disable the overlay AND catch at the call site
        // in the kernel: the config does not remove the swallowing in
        // `InternalKeyHandler`.
        consoleMode: 'disabled',
        openConsoleOnError: false,
        // BB-326 — the trace's first probe point: the raw chunk, BEFORE the
        // parser classifies it. Returning false claims nothing, so the parser
        // still sees every byte. Comparing this line against the `key` line it
        // produces is what separates "the bytes never arrived" from "the parser
        // made something else of them".
        ...(trace === undefined
          ? {}
          : {
              prependInputHandlers: [
                (sequence: string): boolean => {
                  trace.chunk(sequence);
                  return false;
                },
              ],
            }),
        // The cockpit has always painted on the MAIN screen and cleared it on
        // exit. OpenTUI defaults to the alternate screen; keeping the main one
        // is what makes the swap invisible to a user.
        screenMode: 'main-screen',
      })))
    : undefined;
  /**
   * BB-326 Step B — the surface, and now a real layout container.
   *
   * It still fills the terminal from its top-left corner (the anchor
   * `verify-anchor.mjs` guards), but it is a Yoga COLUMN: the frame's regions
   * are its children and Yoga decides where each one begins. Before Step B the
   * kernel computed every row's `top` itself, which is how a framework bought
   * partly for its layout engine ended up using none of it.
   */
  const shell = renderer
    ? new BoxRenderable(renderer, {
        id: 'shell',
        position: 'absolute',
        left: 0,
        top: 0,
        width: '100%',
        height: '100%',
        flexDirection: 'column',
        // BB-375 — transparent to the operator theme (no painted body fill).
        backgroundColor: DEFAULT_BACKGROUND,
      })
    : undefined;
  if (renderer && shell) renderer.root.add(shell);
  return { renderer, shell, ownsRenderer };
}
