import { describe, expect, it } from 'vitest';
import {
  CommandRunner,
  ExecError,
  exec,
  setDefaultCommandRunner,
} from '../../src/core/exec.js';
import type { ConductorLogger } from '../../src/core/logger.js';

interface LogCall {
  level: string;
  obj: Record<string, unknown>;
  msg?: string;
}

function spyLogger(): { log: ConductorLogger; calls: LogCall[] } {
  const calls: LogCall[] = [];
  const mk = (level: string) => (obj: object, msg?: string) =>
    calls.push({ level, obj: obj as Record<string, unknown>, msg });
  return {
    calls,
    log: {
      debug: mk('debug'),
      info: mk('info'),
      warn: mk('warn'),
      error: mk('error'),
    },
  };
}

describe('CommandRunner', () => {
  it('returns stdout and logs debug on success', async () => {
    const { log, calls } = spyLogger();
    const out = await new CommandRunner(log).run('node', [
      '-e',
      'process.stdout.write("hi")',
    ]);
    expect(out).toBe('hi');
    expect(calls.some((c) => c.level === 'debug' && c.msg === 'exec ok')).toBe(
      true,
    );
  });

  it('logs error with context and throws ExecError carrying exitCode + stderr', async () => {
    const { log, calls } = spyLogger();
    const err = await new CommandRunner(log)
      .run('node', ['-e', 'process.stderr.write("boom"); process.exit(3)'])
      .catch((e) => e);
    expect(err).toBeInstanceOf(ExecError);
    expect(err.exitCode).toBe(3);
    expect(err.stderr).toContain('boom');
    const logged = calls.find(
      (c) => c.level === 'error' && c.msg === 'exec failed',
    );
    expect(logged).toBeDefined();
    expect(logged?.obj.file).toBe('node');
    expect(logged?.obj.exitCode).toBe(3);
    expect(logged?.obj.stderr).toContain('boom');
  });

  it('throws ExecError when the binary does not exist', async () => {
    const { log } = spyLogger();
    const err = await new CommandRunner(log)
      .run('definitely-not-a-real-binary-xyz', [])
      .catch((e) => e);
    expect(err).toBeInstanceOf(ExecError);
  });

  it('passes env to the child process when given', async () => {
    const { log } = spyLogger();
    const out = await new CommandRunner(log).run(
      'sh',
      ['-c', 'printf "%s" "$FOO"'],
      { env: { FOO: 'bar' } },
    );
    expect(out).toBe('bar');
  });

  it('merges env over process.env rather than replacing it', async () => {
    const { log } = spyLogger();
    process.env.EXEC_TEST_KEEP = 'kept';
    const out = await new CommandRunner(log).run(
      'sh',
      ['-c', 'printf "%s:%s" "$EXEC_TEST_KEEP" "$FOO"'],
      { env: { FOO: 'bar' } },
    );
    expect(out).toBe('kept:bar');
    delete process.env.EXEC_TEST_KEEP;
  });

  it('redacts logged args via redactArgs while executing the real args', async () => {
    const { log, calls } = spyLogger();
    const secret = 'mysql://user:p@ss@h/db';
    const out = await new CommandRunner(log).run(
      'sh',
      ['-c', `printf "%s" "DB=${secret} claude"`],
      {
        redactArgs: (args) => args.map((a) => a.replace(secret, '<redacted>')),
      },
    );
    // Real args executed unchanged: the child still sees the secret.
    expect(out).toBe(`DB=${secret} claude`);
    // But the logged args are redacted — no plaintext secret in any log obj.
    const debug = calls.find((c) => c.level === 'debug');
    expect(JSON.stringify(debug?.obj)).not.toContain(secret);
    expect(JSON.stringify(debug?.obj)).toContain('<redacted>');
  });

  it('redacts logged args on the error path too', async () => {
    const { log, calls } = spyLogger();
    const secret = 'mysql://user:p@ss@h/db';
    await new CommandRunner(log)
      .run('sh', ['-c', `echo "DB=${secret}"; exit 4`], {
        redactArgs: (args) => args.map((a) => a.replace(secret, '<redacted>')),
      })
      .catch(() => {});
    const errCall = calls.find(
      (c) => c.level === 'error' && c.msg === 'exec failed',
    );
    expect(errCall).toBeDefined();
    expect(JSON.stringify(errCall?.obj)).not.toContain(secret);
  });

  it('exec() delegates to the runner set by setDefaultCommandRunner', async () => {
    const { log, calls } = spyLogger();
    setDefaultCommandRunner(new CommandRunner(log));
    const out = await exec('node', [
      '-e',
      'process.stdout.write("via-default")',
    ]);
    expect(out).toBe('via-default');
    expect(calls.some((c) => c.level === 'debug')).toBe(true);
  });
});
