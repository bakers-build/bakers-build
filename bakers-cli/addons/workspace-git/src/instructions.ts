import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Loads ./WORKFLOW.md from the workspace, hashing its content. */
export function loadInstructions(
  workspacePath: string,
): { path: string; sha256: string; text: string } | null {
  const path = resolve(workspacePath, 'WORKFLOW.md');
  if (!existsSync(path)) {
    return null;
  }
  const text = readFileSync(path, 'utf8');
  return {
    path,
    sha256: createHash('sha256').update(text).digest('hex'),
    text,
  };
}
