import { ExecError, exec } from '@bakers-build/core';

/** Runs `orca <args> --json`; resolves with the envelope's `result`. */
export type OrcaExec = (args: string[]) => Promise<unknown>;

/** An Orca CLI failure, keyed by Orca's own error `code`. */
export class OrcaError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'OrcaError';
  }
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Parse Orca's `--json` envelope. Orca prints BOTH outcomes on stdout —
 * `{ok:true,result}` or `{ok:false,error:{code,message}}` — so `ok` decides,
 * not the exit code.
 */
export function parseEnvelope(stdout: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new OrcaError(
      'invalid_output',
      `orca returned non-JSON output: ${stdout.trim().slice(0, 200)}`,
    );
  }
  if (!isRecord(parsed)) {
    throw new OrcaError('invalid_output', 'orca returned an invalid envelope');
  }
  if (parsed.ok === true) {
    return parsed.result;
  }
  const error = isRecord(parsed.error) ? parsed.error : {};
  const code = typeof error.code === 'string' ? error.code : 'unknown_error';
  const message =
    typeof error.message === 'string' ? error.message : 'orca command failed';
  throw new OrcaError(code, `orca ${code}: ${message}`);
}

/** The real CLI: `bin` (default `orca`, resolved through PATH). */
export function createOrcaExec(bin = 'orca'): OrcaExec {
  return async (args) => {
    let stdout: string;
    try {
      stdout = await exec(bin, [...args, '--json']);
    } catch (err) {
      const cause = (err instanceof ExecError ? err.cause : err) as {
        code?: unknown;
        stdout?: unknown;
      };
      if (cause?.code === 'ENOENT') {
        throw new OrcaError('orca_not_found', 'orca CLI not found in PATH');
      }
      // A non-zero exit still carries Orca's error envelope on stdout.
      if (typeof cause?.stdout === 'string' && cause.stdout.trim()) {
        stdout = cause.stdout;
      } else {
        throw err;
      }
    }
    return parseEnvelope(stdout);
  };
}

/**
 * Fail fast when no Orca runtime answers on this machine. `orca status` never
 * fails itself, so `runtime.reachable` is the signal. Orca is never started
 * implicitly: on a headless oven host `orca open` would launch a desktop app.
 */
export async function assertOrcaReachable(orca: OrcaExec): Promise<void> {
  const status = await orca(['status']);
  const runtime = isRecord(status) ? status.runtime : undefined;
  if (isRecord(runtime) && runtime.reachable === true) {
    return;
  }
  const state =
    isRecord(runtime) && typeof runtime.state === 'string'
      ? runtime.state
      : 'unknown';
  throw new Error(
    `Orca runtime not reachable (state: ${state}). Start Orca on this machine (desktop app or "orca serve") and retry.`,
  );
}
