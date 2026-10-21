import { closeSync, openSync, readSync, statSync } from 'node:fs';

/**
 * How much of the log's tail is read per refresh.
 *
 * The live log on a working machine is megabytes; this view re-reads on every
 * 5 s tick, so it reads a bounded window from the END rather than the file.
 */
const WINDOW_BYTES = 64 * 1024;

/** Default number of formatted lines handed to the renderer. */
const DEFAULT_MAX_LINES = 500;

/** pino's numeric levels, as labels. */
const LEVELS: Record<number, string> = {
  10: 'TRACE',
  20: 'DEBUG',
  30: 'INFO',
  40: 'WARN',
  50: 'ERROR',
  60: 'FATAL',
};

/** Fields consumed by the formatted prefix, not repeated in the k=v tail. */
const CONSUMED = new Set(['level', 'time', 'msg', 'pid', 'hostname']);

export interface LogTail {
  /** Whether the log file exists at all. */
  present: boolean;
  /** Formatted lines, oldest first. */
  lines: string[];
  /** Whether earlier content was cut off by the byte window. */
  truncated: boolean;
}

export interface LogTailOptions {
  maxLines?: number;
}

/**
 * The tail of a conductor's `log.txt`, formatted for reading.
 *
 * The file sink writes raw pino NDJSON (`pino-pretty` serves only the stdout
 * sink), so a dump would be a wall of JSON. Each record becomes
 * `HH:MM:SS LEVEL msg (k=v …)`; anything that is not a pino record — a stack
 * trace, a stray `console.log`, a line the window cut — is passed through
 * verbatim rather than hidden, because a log view that silently drops what it
 * cannot parse is worse than one that shows it.
 *
 * Never throws: this runs inside a TUI refresh, where an unreadable log must
 * leave the screen navigable.
 */
export function tailConductorLog(
  path: string,
  options: LogTailOptions = {},
): LogTail {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;

  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    return {
      present: false,
      lines: [`no log at ${path}`],
      truncated: false,
    };
  }

  const start = Math.max(0, size - WINDOW_BYTES);
  const truncated = start > 0;
  let raw = '';
  try {
    const fd = openSync(path, 'r');
    try {
      const length = size - start;
      const buf = Buffer.alloc(length);
      readSync(fd, buf, 0, length, start);
      raw = buf.toString('utf8');
    } finally {
      closeSync(fd);
    }
  } catch (err) {
    return {
      present: true,
      lines: [`could not read ${path}: ${String(err)}`],
      truncated: false,
    };
  }

  const all = raw.split('\n');
  // The window almost certainly cut through a record; that fragment is not a
  // line the conductor ever wrote, so it is dropped rather than shown broken.
  if (truncated) all.shift();

  const lines = all
    .filter((l) => l.trim() !== '')
    .map(formatLine)
    .slice(-maxLines);

  return { present: true, lines, truncated };
}

function formatLine(line: string): string {
  const record = parseRecord(line);
  if (!record) return line;

  const level = LEVELS[Number(record.level)] ?? String(record.level ?? '');
  const time = formatTime(record.time);
  const msg = typeof record.msg === 'string' ? record.msg : '';
  const context = Object.entries(record)
    .filter(([k, v]) => !CONSUMED.has(k) && v !== undefined)
    .map(([k, v]) => `${k}=${renderValue(v)}`)
    .join(' ');

  const head = [time, level.padEnd(5), msg].filter(Boolean).join(' ');
  return context === '' ? head : `${head}  (${context})`;
}

function parseRecord(line: string): Record<string, unknown> | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    // A pino record is an object with a numeric level; anything else that
    // happens to be JSON is not ours to reformat.
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as { level?: unknown }).level === 'number'
    ) {
      return parsed as Record<string, unknown>;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function formatTime(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function renderValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}
