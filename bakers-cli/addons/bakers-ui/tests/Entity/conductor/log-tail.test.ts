import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tailConductorLog } from '../../../src/Entity/conductor/Data/log-tail.js';

/**
 * The conductor log, tailed and formatted.
 *
 * Two facts drive every decision here. The file sink writes raw pino NDJSON —
 * `pino-pretty` only ever serves the stdout sink — so dumping the file would
 * show the operator a wall of JSON. And it is large: the live one on this
 * machine is 4.5 MB, which rules out `readFile` for a view that re-reads every
 * five seconds.
 */
describe('tailConductorLog', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bakers-log-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const write = (lines: string[]): string => {
    const path = join(dir, 'log.txt');
    writeFileSync(path, `${lines.join('\n')}\n`);
    return path;
  };

  const entry = (over: Record<string, unknown> = {}): string =>
    JSON.stringify({
      level: 30,
      time: Date.UTC(2026, 7, 3, 14, 5, 6),
      msg: 'conductor tick',
      ...over,
    });

  it('reports an absent file honestly, naming the path', () => {
    const path = join(dir, 'nope.txt');

    const out = tailConductorLog(path);

    expect(out.present).toBe(false);
    expect(out.lines.length).toBe(1);
    expect(out.lines[0]).toContain(path);
  });

  it('formats a pino record instead of dumping its JSON', () => {
    const out = tailConductorLog(write([entry()]));

    expect(out.present).toBe(true);
    expect(out.lines[0]).toContain('conductor tick');
    expect(out.lines[0]).not.toContain('{');
    expect(out.lines[0]).toMatch(/\d\d:\d\d:\d\d/);
  });

  it('labels the pino levels', () => {
    const out = tailConductorLog(
      write([
        entry({ level: 20, msg: 'dbg' }),
        entry({ level: 30, msg: 'inf' }),
        entry({ level: 40, msg: 'wrn' }),
        entry({ level: 50, msg: 'err' }),
      ]),
    );

    const text = out.lines.join('\n');
    expect(text).toContain('DEBUG');
    expect(text).toContain('INFO');
    expect(text).toContain('WARN');
    expect(text).toContain('ERROR');
  });

  it('carries the extra fields as k=v, so context is not lost', () => {
    const out = tailConductorLog(
      write([entry({ conductorId: 'cw-framework', active: 2 })]),
    );

    expect(out.lines[0]).toContain('conductorId=cw-framework');
    expect(out.lines[0]).toContain('active=2');
  });

  it('passes a non-JSON line through verbatim', () => {
    const out = tailConductorLog(
      write(['not json at all', entry({ msg: 'after' })]),
    );

    expect(out.lines[0]).toBe('not json at all');
    expect(out.lines[1]).toContain('after');
  });

  it('reads only the tail of a file larger than the window', () => {
    // Each record is padded so the file comfortably exceeds 64 KiB; only the
    // last records may survive, and the earliest must not.
    const many = Array.from({ length: 2000 }, (_, i) =>
      entry({ msg: `line-${i}`, pad: 'x'.repeat(200) }),
    );
    const out = tailConductorLog(write(many));

    const text = out.lines.join('\n');
    expect(text).toContain('line-1999');
    expect(text).not.toContain('line-0 ');
    expect(out.truncated).toBe(true);
  });

  it('drops the partial first line the byte window cuts through', () => {
    const many = Array.from({ length: 2000 }, (_, i) =>
      entry({ msg: `line-${i}`, pad: 'x'.repeat(200) }),
    );
    const out = tailConductorLog(write(many));

    // A cut record would arrive as a JSON fragment and fall through to the
    // verbatim branch, showing the operator half a brace.
    for (const line of out.lines) {
      expect(line.startsWith('{')).toBe(false);
      expect(line.endsWith('}')).toBe(false);
    }
  });

  it('does not report truncation for a small file', () => {
    const out = tailConductorLog(write([entry()]));

    expect(out.truncated).toBe(false);
  });

  it('honours a caller-set line limit, keeping the newest', () => {
    const out = tailConductorLog(
      write([
        entry({ msg: 'oldest' }),
        entry({ msg: 'middle' }),
        entry({ msg: 'newest' }),
      ]),
      { maxLines: 2 },
    );

    expect(out.lines.length).toBe(2);
    expect(out.lines.join('\n')).toContain('newest');
    expect(out.lines.join('\n')).not.toContain('oldest');
  });
});
