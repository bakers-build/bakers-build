import { describe, expect, it } from 'vitest';
import {
  runtimeSandboxWarning,
  yoloWithoutIsolationWarnings,
} from '../../src/plugins/sandbox-preflight.js';

// `yolo` bypasses every harness permission check, so it belongs inside a
// runtime that isolates the run from the machine.

const HOST = { id: 'host', isolates: false };
const DOCKER = { id: 'docker', isolates: true };
const lineFor = (agent: string, runtime: string) =>
  `warning: ${agent}: permissions 'yolo' runs without isolation on runtime ${runtime}; use an isolating runtime (runtime-docker, runtime-bwrap) — see https://bakers.build/docs/agents/isolation`;

describe('yolo without an isolating runtime', () => {
  it('warns once per yolo agent on the host, naming agent and runtime', () => {
    expect(
      yoloWithoutIsolationWarnings(
        [{ id: 'claude', permissions: 'yolo' }],
        HOST,
      ),
    ).toEqual([lineFor('claude', 'host')]);
  });

  it('names the host when no runtime is configured', () => {
    expect(
      yoloWithoutIsolationWarnings([{ id: 'claude', permissions: 'yolo' }]),
    ).toEqual([lineFor('claude', 'host')]);
  });

  it('stays silent for yolo inside an isolating runtime', () => {
    expect(
      yoloWithoutIsolationWarnings(
        [{ id: 'claude', permissions: 'yolo' }],
        DOCKER,
      ),
    ).toEqual([]);
  });

  it('stays silent for sandbox and system modes on the host', () => {
    expect(
      yoloWithoutIsolationWarnings(
        [
          { id: 'claude', permissions: 'sandbox' },
          { id: 'codex', permissions: 'system' },
        ],
        HOST,
      ),
    ).toEqual([]);
  });

  it('with mixed agents warns only for yolo ones, deduplicated, and skips an unknown mode', () => {
    expect(
      yoloWithoutIsolationWarnings(
        [
          { id: 'claude', alias: 'a', permissions: 'yolo' },
          { id: 'claude', alias: 'b', permissions: 'sandbox' },
          { id: 'codex', permissions: 'yolo' },
          { id: 'codex', permissions: 'yolo' },
          { id: 'kimi' },
        ],
        HOST,
      ),
    ).toEqual([lineFor('a', 'host'), lineFor('codex', 'host')]);
  });
});

describe('host-only sandbox preflight warning', () => {
  it('is dropped when the runtime isolates and every agent runs yolo', () => {
    expect(
      runtimeSandboxWarning('docker', {
        isolates: true,
        modes: ['yolo', 'yolo'],
      }),
    ).toBeUndefined();
  });

  it('stays for mixed modes, no reported modes, or a non-isolating runtime', () => {
    const hostOnly = /host only.*docker.*not checked/;
    expect(
      runtimeSandboxWarning('docker', {
        isolates: true,
        modes: ['yolo', 'sandbox'],
      }),
    ).toMatch(hostOnly);
    expect(
      runtimeSandboxWarning('docker', { isolates: true, modes: [] }),
    ).toMatch(hostOnly);
    expect(
      runtimeSandboxWarning('docker', { isolates: true, modes: [undefined] }),
    ).toMatch(hostOnly);
    expect(runtimeSandboxWarning('docker')).toMatch(hostOnly);
    expect(runtimeSandboxWarning('host', { modes: ['yolo'] })).toBeUndefined();
  });
});
