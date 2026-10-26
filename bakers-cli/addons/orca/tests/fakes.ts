import { OrcaError, type OrcaExec } from '../src/orca-cli.js';

export const REACHABLE = { runtime: { reachable: true, state: 'ready' } };

/**
 * A scripted `orca`: records every call and answers by the first two argv
 * words (`worktree show`, `terminal create`, …). A handler that throws an
 * `OrcaError` behaves like Orca's `ok:false` envelope.
 */
export function fakeOrca(
  handlers: Record<string, (args: string[]) => unknown> = {},
): { orca: OrcaExec; calls: string[][] } {
  const calls: string[][] = [];
  const orca: OrcaExec = async (args) => {
    calls.push(args);
    const key = args.slice(0, 2).join(' ');
    const handler = handlers[key] ?? handlers[args[0] ?? ''];
    if (handler) return handler(args);
    if (args[0] === 'status') return REACHABLE;
    return {};
  };
  return { orca, calls };
}

export function notFound(): never {
  throw new OrcaError('selector_not_found', 'orca selector_not_found');
}
