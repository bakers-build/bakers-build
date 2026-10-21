import type { CliRenderer } from '@opentui/core';
import type { ClipboardOutcome, ClipboardWriter } from '../types.js';

/**
 * BB-326 — the ONE place in this package that touches the operator's system
 * clipboard.
 *
 * WHY OSC 52 AND NOT A LOCAL CLIPBOARD TOOL. The operator drives the cockpit
 * from a phone, over mosh, in Ghostty. An `xclip`/`wl-copy` on this host would
 * write into the clipboard of a machine they are not sitting at. An OSC 52
 * escape travels the other way — out through the pty, up the ssh/mosh link, to
 * the terminal emulator in their hand, which is the only clipboard that is any
 * use to them. It is also why this works at all where the terminal's own
 * drag-selection does not: `@opentui/core@0.5.1` emits `?1002h` unconditionally
 * from its Zig core (`tests/pty/verify-mouse-modes.mjs`, known deviation), so
 * selecting text by dragging is gone and the cockpit has to copy for them.
 *
 * WHY THE OUTCOME IS FOUR-VALUED. `Clipboard.copyToClipboardOSC52` refuses only
 * when the probed capability is literally `unsupported`; a terminal that never
 * answered the probe reports `unknown` and DOES get the escape. Those two
 * cannot honestly share a word — see `lib/clipboard.ts` for the wording. The
 * renderer's `isOsc52Supported()` collapses them (`!== 'unsupported'`), so the
 * distinction is read off `capabilities.osc52_support` here.
 *
 * NOTHING IS COPIED WITHOUT A KEYSTROKE THAT ASKED. This module has no callers
 * on the draw path, the navigation path or the resize path — it is reached from
 * a screen's key handler and nowhere else. Guarded on a real pty by
 * `tests/pty/verify-clipboard.mjs`, which asserts the total number of OSC 52
 * writes over a whole session, not just their contents.
 */
export function clipboardWriter(
  renderer: CliRenderer | undefined,
): ClipboardWriter {
  return (text: string): ClipboardOutcome => {
    if (renderer === undefined || text === '') return 'failed';
    try {
      if (!renderer.isOsc52Supported()) return 'unsupported';
      // The default `ClipboardTarget.Clipboard` — the `c` selection, i.e. the
      // system clipboard. Not `Primary`: an X11 primary selection is the
      // middle-click buffer and is not what a phone has.
      if (!renderer.copyToClipboardOSC52(text)) return 'failed';
      return renderer.capabilities?.osc52_support === 'supported'
        ? 'copied'
        : 'unconfirmed';
    } catch {
      // A renderer with no native core behind it (the injected test renderer)
      // throws rather than answering. That is a failed copy, not a crashed
      // cockpit: the key handler must return either way.
      return 'failed';
    }
  };
}
