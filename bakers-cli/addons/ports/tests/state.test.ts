import { describe, expect, it, vi } from 'vitest';
import type { StateDeps } from '../src/state.js';
import { readTunnelState } from '../src/state.js';
import type { TunnelRecord } from '../src/types.js';

const record = (port: number): TunnelRecord => ({
  port,
  target: `http://127.0.0.1:${port}`,
  pid: 4242,
  url: `https://bb-475-${port}.trycloudflare.com`,
  startedAt: 1_700_000_000,
});

/** An in-memory file, so a test never touches disk. */
const memoryDeps = (initial?: string) => {
  const store = new Map<string, string>();
  if (initial !== undefined) store.set('/wt/.bakers/ports-tunnels.json', initial);
  const deps: StateDeps = {
    readFile: vi.fn(async (path: string) => store.get(path) ?? null),
  };
  return { deps };
};

describe('the tunnel state file', () => {
  it('reads an absent file as OFF — no tunnels, not an error (spec D3)', async () => {
    const { deps } = memoryDeps();
    expect(await readTunnelState('/wt', deps)).toEqual({ tunnels: [] });
  });

  it('reads a written record back', async () => {
    const { deps } = memoryDeps(JSON.stringify({ tunnels: [record(6006)] }));
    expect(await readTunnelState('/wt', deps)).toEqual({
      tunnels: [record(6006)],
    });
  });

  it('reads malformed JSON as OFF rather than throwing', async () => {
    const { deps } = memoryDeps('{ not json');
    expect(await readTunnelState('/wt', deps)).toEqual({ tunnels: [] });
  });
});
