// BB-475 D3 — the tunnel state file: one file in the worktree, absence = off.
//
// It is the whole point of the feature. The orphans this addon was built to
// recover exist precisely because nothing ever wrote this file, so the state a
// tunnel leaves behind is a first-class artifact, not a cache — and its ABSENCE
// is a meaning, not a missing cache: no file ⇒ no tunnels.

import type { TunnelRecord, TunnelState } from './types.js';

/** The filesystem seam, injected so a test never touches disk. */
export interface StateDeps {
  /** The file's content, or `null` when it does not exist. */
  readFile(path: string): Promise<string | null>;
}

/**
 * The state file's path for a worktree: `<worktree>/.bakers/ports-tunnels.json`.
 *
 * Under `.bakers/` because that directory is already the worktree's control-plane
 * scratch space and is git-ignored, so the file never shows up in a diff.
 */
function stateFilePath(worktree: string): string {
  const trimmed = worktree.replace(/\/+$/, '');
  return `${trimmed}/.bakers/ports-tunnels.json`;
}

/**
 * Read the worktree's tunnels. An absent OR malformed file reads as OFF.
 *
 * Malformed is folded into off deliberately: a half-written file is not a reason
 * to refuse the whole command, and `reap` exists exactly to recover from a state
 * the addon can no longer trust. The strict alternative would turn a corrupt
 * byte into a dead CLI.
 */
export async function readTunnelState(
  worktree: string,
  deps: StateDeps,
): Promise<TunnelState> {
  const raw = await deps.readFile(stateFilePath(worktree));
  if (raw === null) return { tunnels: [] };
  try {
    const parsed = JSON.parse(raw) as unknown;
    const tunnels = (parsed as { tunnels?: unknown }).tunnels;
    return Array.isArray(tunnels)
      ? { tunnels: tunnels as TunnelRecord[] }
      : { tunnels: [] };
  } catch {
    return { tunnels: [] };
  }
}
