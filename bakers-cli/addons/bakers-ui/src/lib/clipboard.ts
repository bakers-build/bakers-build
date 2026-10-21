import type { ClipboardOutcome, ClipboardWriter } from '../types.js';

/**
 * BB-326 — what the operator READS after asking for a copy, and the one rule
 * the wording follows: never claim more than the outcome does.
 *
 * WHY THERE IS FEEDBACK AT ALL. An OSC 52 write paints nothing. The escape
 * leaves for the operator's terminal emulator and either lands in their system
 * clipboard or does not, and the cockpit is never told which. A copy that
 * silently succeeds is therefore indistinguishable from one that silently
 * failed — so the footer states the outcome, every time, and states the four
 * outcomes differently.
 *
 * WHY FOUR OUTCOMES AND NOT TWO. `@opentui/core@0.5.1` probes the terminal and
 * reports `supported | unknown | unsupported`
 * (`TerminalCapabilities.osc52_support`), and `Clipboard.copyToClipboardOSC52`
 * refuses ONLY on `unsupported`. So an `unknown` terminal — one that never
 * answered the probe, which is what a plain `TERM=xterm-256color` pty is —
 * really does get the escape, and the copy really may have worked. Reporting
 * that as `copied` would be a claim the cockpit cannot back; reporting it as a
 * failure would be a lie in the other direction. It gets its own word.
 *
 * The wording stays SHORT because the kernel's `fitLine` truncates the footer
 * from the right (`Kernel/frame.ts`), and the notice shares that row with the
 * screen's own key hints.
 */
export function clipboardStatus(
  outcome: ClipboardOutcome,
  what: string,
): string {
  switch (outcome) {
    case 'copied':
      return `copied ${what}`;
    case 'unconfirmed':
      // Deliberately still opens with `copied`: the escape WAS sent, and on
      // Ghostty — where the operator actually is — it works. The qualifier is
      // what stops it being a promise. Kept to four words because it shares the
      // footer with the screen's key ladder; the long version pushed `q quit`
      // off a 120-column terminal, measured.
      return `copied ${what} · OSC 52 unconfirmed`;
    case 'unsupported':
      return 'not copied · this terminal refuses OSC 52 clipboard writes';
    default:
      return 'not copied · the OSC 52 write failed';
  }
}

/**
 * Put `text` in the operator's clipboard and return the line that says so.
 *
 * SECURITY, and the reason this takes the text as an argument rather than
 * reaching for it: OSC 52 writes into the operator's REAL system clipboard,
 * clobbering whatever was there. So it is only ever reached from a keystroke
 * that explicitly asked for a copy — never from navigation, a reload, a resize
 * or a draw — and it copies exactly the one thing that keystroke named.
 *
 * `absent` is what to say when the caller has nothing to copy (a ticket with no
 * link because the session has no base URL). Nothing is written in that case:
 * an empty OSC 52 write would silently WIPE the operator's clipboard, which is
 * a worse outcome than the copy not happening.
 */
export function copyThrough(
  writer: ClipboardWriter | undefined,
  text: string | undefined,
  what: string,
  absent: string,
): string {
  if (text === undefined || text === '') return absent;
  // No writer means no terminal — the non-interactive `bakers ui` path, which
  // writes plain lines to a pipe and never sees a keystroke. Stated rather than
  // silently treated as a failure of the terminal's.
  if (writer === undefined) return 'not copied · no terminal to copy through';
  return clipboardStatus(writer(text), what);
}
