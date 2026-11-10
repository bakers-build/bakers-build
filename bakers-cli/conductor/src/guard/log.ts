import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homeBbDir } from '@bakers-build/core';
import type { GuardLogEntry } from './hook.js';

/** Where a run's guard refusals go: outside its worktree, keyed by the run. */
export function guardLogPath(runUuid: string): string {
  return join(homeBbDir(), 'runs', `${runUuid}.guard.jsonl`);
}

/** The run's refusals, oldest first; none when the file is absent. */
export function readGuardLog(runUuid: string): GuardLogEntry[] {
  let text: string;
  try {
    text = readFileSync(guardLogPath(runUuid), 'utf8');
  } catch {
    return [];
  }
  return text.split('\n').flatMap((line) => {
    try {
      return line ? [JSON.parse(line) as GuardLogEntry] : [];
    } catch {
      return [];
    }
  });
}
