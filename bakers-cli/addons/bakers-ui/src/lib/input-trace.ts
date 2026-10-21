import { appendFileSync } from 'node:fs';

/**
 * BB-326 — trace one keystroke from the wire to the screen that answers it.
 *
 * An operator reports that Escape does nothing over their link while every rig
 * here says it works. `tests/pty/capture-input.mjs` already proved the BYTES
 * arrive intact on that link, which eliminates the transport and leaves three
 * suspects that no capture outside the process can separate: the parser (does a
 * lone ESC become an `escape` event, or is it folded into something else?), the
 * adapter (does `keyEventToKeys` hand back the literal the ladder compares
 * against?), and the ladder itself (which screen received it, did it claim the
 * key, and what did the router do?).
 *
 * So this records all three, one JSON object per line, in order. It is off
 * unless `$BB_UI_INPUT_TRACE` names a file, and when off it is not merely
 * cheap but absent — `createInputTrace` returns `undefined` and every call site
 * is an optional-chain that compiles to a null check.
 *
 * Writes are SYNCHRONOUS on purpose. One of the hypotheses is a cockpit wedged
 * mid-keystroke, and a buffered writer loses exactly the last line — the one
 * that matters — when the process never gets to flush it.
 */
export interface InputTrace {
  /** A raw stdin chunk, before the parser sees it. */
  chunk(sequence: string): void;
  /** A parsed key event, and what the adapter made of it. */
  key(event: TracedKeyEvent, keys: readonly string[]): void;
  /** What the ladder did with one key. */
  route(entry: TracedRoute): void;
  close(): void;
}

/** The fields of OpenTUI's `KeyEvent` this trace reads. */
export interface TracedKeyEvent {
  readonly name?: string | undefined;
  readonly sequence?: string | undefined;
  readonly raw?: string | undefined;
  readonly meta?: boolean | undefined;
  readonly ctrl?: boolean | undefined;
  readonly shift?: boolean | undefined;
}

export interface TracedRoute {
  readonly key: string;
  readonly screen: string;
  /** Did the screen itself claim the key? */
  readonly handled: boolean;
  /** Which branch of the ladder ran: `back`, `fallback`, `action`, … */
  readonly outcome: string;
}

/** Bytes as hex pairs — the same form `capture-input.mjs` logs, so the two align. */
const hex = (value: string | undefined): string =>
  value === undefined
    ? ''
    : [...Buffer.from(value, 'utf8')]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join(' ');

export function createInputTrace(
  path: string | undefined,
  now: () => number = Date.now,
): InputTrace | undefined {
  if (path === undefined || path === '') return undefined;

  const started = now();
  const write = (record: Record<string, unknown>): void => {
    try {
      appendFileSync(
        path,
        `${JSON.stringify({ atMs: now() - started, ...record })}\n`,
      );
    } catch {
      // A diagnostic that can take the cockpit down is worse than no
      // diagnostic: an unwritable path must not become a crash on every key.
    }
  };

  write({ kind: 'open', pid: process.pid, term: process.env.TERM ?? '' });

  return {
    chunk(sequence) {
      write({ kind: 'chunk', hex: hex(sequence) });
    },
    key(event, keys) {
      write({
        kind: 'key',
        name: event.name ?? '',
        sequenceHex: hex(event.sequence),
        rawHex: hex(event.raw),
        meta: event.meta === true,
        ctrl: event.ctrl === true,
        shift: event.shift === true,
        // The adapter's output is the claim the whole migration rests on: these
        // are the literals `Form/keys.ts` and 58 Entity screens compare against.
        keysHex: keys.map((key) => hex(key)),
      });
    },
    route(entry) {
      write({ kind: 'route', ...entry, keyHex: hex(entry.key) });
    },
    close() {
      write({ kind: 'close' });
    },
  };
}
