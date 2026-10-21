import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  createLogger,
  resolveLevel,
  resolveSink,
} from '../../src/core/logger.js';

const ROOT = '/tmp/bakers-checkout';

describe('resolveSink', () => {
  it('override=stdout wins over non-TTY', () => {
    expect(resolveSink({ BB_CONDUCTOR_LOG: 'stdout' }, false, ROOT)).toEqual({
      kind: 'stdout',
    });
  });

  it('override=file wins over TTY', () => {
    expect(resolveSink({ BB_CONDUCTOR_LOG: 'file' }, true, ROOT)).toEqual({
      kind: 'file',
      path: '/tmp/bakers-checkout/.bakers/log.txt',
    });
  });

  // BB-237 AC-4: the TTY default used to be stdout-ONLY, so every conductor
  // run inside a herdr pane (a TTY) wrote no log.txt at all — a well-formed
  // `lifecycle hook failed` record died with the pane and the aborting worktree
  // bootstrap left no durable trace anywhere. The default now tees: the
  // operator still sees pretty stdout AND the record is durable. Only an
  // EXPLICIT override narrows it back to one stream.
  it('no override + TTY → both (stdout AND the durable log.txt)', () => {
    expect(resolveSink({}, true, ROOT)).toEqual({
      kind: 'both',
      path: '/tmp/bakers-checkout/.bakers/log.txt',
    });
  });

  it('no override + no TTY → file', () => {
    expect(resolveSink({}, false, ROOT)).toEqual({
      kind: 'file',
      path: '/tmp/bakers-checkout/.bakers/log.txt',
    });
  });

  it('override=stdout on a TTY still means stdout ONLY (explicit narrows the default)', () => {
    expect(resolveSink({ BB_CONDUCTOR_LOG: 'stdout' }, true, ROOT)).toEqual({
      kind: 'stdout',
    });
  });

  it('the CLI override beats the env var and still narrows the TTY default', () => {
    expect(
      resolveSink({ BB_CONDUCTOR_LOG: 'file' }, true, ROOT, 'stdout'),
    ).toEqual({ kind: 'stdout' });
  });

  // BB-450 D4: `checkoutRoot` is genuinely the checkout root now (widened
  // from the `.bakers` config directory it used to store), so the log always
  // lands under its OWN `.bakers/log.txt` — never directly at `<root>/log.txt`.
  it('appends .bakers/log.txt to the checkout root, never writing log.txt at its top level', () => {
    expect(resolveSink({}, false, '/proj')).toEqual({
      kind: 'file',
      path: '/proj/.bakers/log.txt',
    });
  });
});

describe('resolveLevel', () => {
  it('defaults to info', () => {
    expect(resolveLevel({})).toBe('info');
  });

  it('honors BB_LOG_LEVEL', () => {
    expect(resolveLevel({ BB_LOG_LEVEL: 'debug' })).toBe('debug');
  });
});

describe('createLogger', () => {
  it('returns a logger exposing the four level methods', () => {
    const log = createLogger({ checkoutRoot: ROOT, isTTY: true, env: {} });
    for (const level of ['debug', 'info', 'warn', 'error'] as const) {
      expect(typeof log[level]).toBe('function');
    }
  });

  it('does not throw when logging to the stdout sink', () => {
    const log = createLogger({ checkoutRoot: ROOT, isTTY: true, env: {} });
    expect(() => log.info({ a: 1 }, 'hello')).not.toThrow();
  });

  it('on a TTY it STILL writes the durable log.txt (BB-237 AC-4)', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'bakers-logger-tty-'));
    const log = createLogger({ checkoutRoot: tempRoot, isTTY: true, env: {} });

    log.error({ hook: 'after_create', ticket: 'BB-237' }, 'hook failed');

    const written = readFileSync(join(tempRoot, '.bakers', 'log.txt'), 'utf8');
    expect(written).toContain('hook failed');
    expect(written).toContain('BB-237');
    const record = JSON.parse(written.trim()) as { bb_version?: string };
    expect(record.bb_version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('prints bb_version through the pretty stdout side of the both sink', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'bakers-logger-both-'));
    const chunks: string[] = [];
    const destination = new PassThrough();
    destination.on('data', (chunk) => chunks.push(String(chunk)));
    createLogger({
      checkoutRoot: tempRoot,
      isTTY: true,
      env: {},
      prettyDestination: destination,
    }).info({}, 'versioned');
    expect(chunks.join('')).toMatch(/bb_version.*\d+\.\d+\.\d+/s);
  });

  it('does not throw when logging to the file sink', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'bakers-logger-test-'));
    const log = createLogger({
      checkoutRoot: tempRoot,
      isTTY: false,
      env: { BB_CONDUCTOR_LOG: 'file' },
    });
    expect(() => log.info({ a: 1 }, 'x')).not.toThrow();
    for (const level of ['debug', 'info', 'warn', 'error'] as const) {
      expect(typeof log[level]).toBe('function');
    }
  });
});
