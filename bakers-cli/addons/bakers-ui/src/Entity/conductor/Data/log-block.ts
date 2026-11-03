// The conductor log block: where it is, and its tail — the single home for
// what was duplicated character for character in both Conductors screens.
import { configHomeOf } from '@bakers-build/core';
import type { ConductorDetail } from './detail.js';
import { tailConductorLog } from './log-tail.js';

export interface ConductorLog {
  readonly heading: string;
  readonly lines: readonly string[];
}

/**
 * Whether the log block should tail a real file — true only when the
 * detail's own machine UUID matches THIS process's. An absent key on
 * either side is never waved through as a match: an unproven identity is
 * refused, the same rule the Conductors list's `mine` uses.
 */
export function isMine(
  detail: ConductorDetail,
  thisMachineId: string | undefined,
): boolean {
  return (
    detail.machineId !== undefined &&
    thisMachineId !== undefined &&
    detail.machineId === thisMachineId
  );
}

/**
 * The open row's log block: where it is, and its tail. A conductor on
 * another machine has a workspace this machine cannot read, so the block
 * states that instead of showing an empty tail.
 */
export function logBlockFor(
  detail: ConductorDetail,
  mine: boolean,
): ConductorLog {
  const logPath = `${configHomeOf(detail.workspaceRoot)}/log.txt`;
  return mine
    ? {
        heading: `log — ${logPath}`,
        lines: tailConductorLog(logPath, { maxLines: 40 }).lines,
      }
    : {
        heading: `log — ${detail.label} runs on another machine; no log here`,
        lines: [],
      };
}
