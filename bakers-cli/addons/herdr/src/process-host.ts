import type { HerdrHost } from '@bakers-build/conductor/contract';
import { exec } from '@bakers-build/core';
import { isRecord, parseJson } from './pane-layout.js';
import { parseWorkspaceList } from './workspace-list.js';

function parseWorkspaceCreate(output: string): string {
  const parsed = parseJson(output, 'workspace create');
  const paneId = isRecord(parsed)
    ? (parsed.result as { root_pane?: { pane_id?: unknown } } | undefined)
        ?.root_pane?.pane_id
    : undefined;
  if (typeof paneId !== 'string' || paneId === '') {
    throw new Error('herdr workspace create returned no pane id');
  }
  return paneId;
}

/**
 * Close every herdr workspace whose label equals the conductor handle, then
 * create one and `exec env` the pane command so herdr auto-closes on exit.
 */
export const herdrProcessHost: HerdrHost = {
  async spawn(label, cwd, cmd) {
    const listed = parseWorkspaceList(
      await exec('herdr', ['workspace', 'list']),
    );
    for (const ws of listed) {
      if (ws.label === label) {
        try {
          await exec('herdr', ['workspace', 'close', ws.workspaceId]);
        } catch {
          // herdr may already have auto-closed it after a previous stop
        }
      }
    }
    const paneId = parseWorkspaceCreate(
      await exec('herdr', [
        'workspace',
        'create',
        '--cwd',
        cwd,
        '--label',
        label,
        '--no-focus',
      ]),
    );
    // `exec env` replaces the pane's login shell (fish-safe VAR=value form)
    // so herdr closes the workspace when the conductor exits by any path.
    // `env` needs a real `bakers` executable on PATH.
    await exec('herdr', ['pane', 'run', paneId, `exec env ${cmd}`]);
  },
};
