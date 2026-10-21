#!/usr/bin/env node
/**
 * BB-326 — capture the raw key bytes a terminal actually delivers.
 *
 * Why this exists: the cockpit's Escape handling depends on how the bytes are
 * CHUNKED, not only on which bytes arrive. `mosh` ships the first byte of a
 * burst immediately and rate-limits the rest into its next send interval, so
 * two Escape taps can arrive as one write of `1b 1b`. OpenTUI's stdin parser
 * folds a byte following ESC into a single event, and the key ladder compares
 * `key === '\x1b'` — so a glued Escape is swallowed, and the key after it with
 * it.
 *
 * Reproducing that needs the operator's own link, because it is a property of
 * the network path and the keyboard app, not of the cockpit. This script runs
 * on that link with no dependencies and no build step, records every chunk with
 * a timestamp, and writes a log that can be replayed byte-for-byte through the
 * parser somewhere else. Capture here, diagnose there.
 *
 * Usage, inside the session you want to measure (mosh, ssh, herdr, whatever):
 *
 *   node bakers-cli/addons/bakers-ui/tests/pty/capture-input.mjs
 *
 * Then press the keys that misbehave — for Escape, tap it several times in
 * quick succession, since a single isolated tap is known to work. Press
 * Ctrl+] to stop. The log path is printed at the end; send that file on.
 *
 * Ctrl+C is deliberately NOT an exit key: it is one of the keys under
 * investigation, so it is recorded like any other.
 */

import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const STOP = 0x1d; // Ctrl+]
const logPath = join(tmpdir(), `bakers-input-capture-${process.pid}.jsonl`);
const log = createWriteStream(logPath, { flags: 'a' });

const started = Date.now();
let chunkCount = 0;

/** Bytes as lowercase hex pairs — the form the replay reads back. */
const hex = (buffer) =>
  [...buffer].map((b) => b.toString(16).padStart(2, '0')).join(' ');

/** A human-readable rendering: control bytes as caret notation, the rest literal. */
const caret = (buffer) =>
  [...buffer]
    .map((b) => {
      if (b === 0x1b) return 'ESC';
      if (b < 0x20) return `^${String.fromCharCode(b + 64)}`;
      if (b === 0x7f) return 'DEL';
      if (b < 0x7f) return String.fromCharCode(b);
      return `\\x${b.toString(16).padStart(2, '0')}`;
    })
    .join(' ');

const environment = {
  term: process.env.TERM ?? '',
  // Present under mosh, and the single most useful line in the whole log.
  mosh:
    process.env.MOSH_CONNECTION !== undefined ||
    process.env.MOSH_KEY !== undefined,
  ssh: process.env.SSH_CONNECTION !== undefined,
  herdr: process.env.HERDR_ENV === '1',
  tmux: process.env.TMUX !== undefined,
  columns: process.stdout.columns ?? 0,
  rows: process.stdout.rows ?? 0,
  node: process.version,
};

log.write(`${JSON.stringify({ kind: 'environment', ...environment })}\n`);

process.stdout.write(
  [
    '',
    'BB-326 input capture',
    '======================',
    `  TERM=${environment.term}  ${environment.columns}x${environment.rows}`,
    `  mosh=${environment.mosh}  ssh=${environment.ssh}  herdr=${environment.herdr}  tmux=${environment.tmux}`,
    '',
    '  Press the keys that misbehave. For Escape, tap it SEVERAL TIMES in quick',
    '  succession — one isolated tap is already known to work.',
    '',
    '  Ctrl+C is recorded, not honoured. Press Ctrl+] to stop.',
    '',
    '  elapsed   bytes  hex                      keys',
    '  --------  -----  -----------------------  ----',
    '',
  ].join('\n'),
);

if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.resume();

process.stdin.on('data', (chunk) => {
  const atMs = Date.now() - started;
  chunkCount += 1;

  log.write(
    `${JSON.stringify({ kind: 'chunk', atMs, bytes: chunk.length, hex: hex(chunk) })}\n`,
  );

  // One line per WRITE, not per byte: the chunk boundary is the whole point.
  // Two Escapes on one line is the defect; two lines is a healthy link.
  process.stdout.write(
    `  ${String(atMs).padStart(8)}  ${String(chunk.length).padStart(5)}  ${hex(chunk).padEnd(23)}  ${caret(chunk)}\r\n`,
  );

  if (chunk.includes(STOP)) {
    process.stdout.write(
      `\r\n  ${chunkCount} chunks recorded.\r\n  Log: ${logPath}\r\n  Send that file on.\r\n\r\n`,
    );
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    log.end(() => process.exit(0));
  }
});
