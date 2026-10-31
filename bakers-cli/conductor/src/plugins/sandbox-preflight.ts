import { execFile } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';

/** Whether an agent's sandbox can start on this machine; see {@link BbAgent.sandboxPreflight}. */
export type SandboxPreflight =
  | { ok: true }
  | { ok: false; cause: string; fix: string };

/** The machine a preflight inspects; injected by tests. */
export interface SandboxHost {
  platform: NodeJS.Platform;
  /** Whether `name` is an executable on `PATH`. */
  onPath(name: string): boolean;
  /** Runs a probe command; never throws. */
  run(cmd: string, args: string[]): Promise<{ ok: boolean; stderr: string }>;
}

export function systemSandboxHost(env = process.env): SandboxHost {
  return {
    platform: process.platform,
    onPath: (name) =>
      (env.PATH ?? '').split(delimiter).some((dir) => {
        try {
          accessSync(join(dir, name), constants.X_OK);
          return true;
        } catch {
          return false;
        }
      }),
    run: (cmd, args) =>
      new Promise((resolve) => {
        execFile(cmd, args, { env, timeout: 15_000 }, (err, _out, stderr) => {
          resolve({ ok: !err, stderr: String(stderr || err?.message || '') });
        });
      }),
  };
}

/** The last non-empty line of a probe's stderr: the error, after any warnings. */
export function lastLine(text: string): string {
  return (
    text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .pop() ?? 'no error output'
  );
}

/** The platform's install command for `packages`, from the package manager on `PATH`. */
export function installCommand(host: SandboxHost, packages: string[]): string {
  const managers: [string, string][] = [
    ['apt-get', 'sudo apt-get install -y'],
    ['dnf', 'sudo dnf install -y'],
    ['pacman', 'sudo pacman -S --needed'],
  ];
  const found = managers.find(([bin]) => host.onPath(bin));
  return found
    ? `${found[1]} ${packages.join(' ')}`
    : `your package manager (packages: ${packages.join(', ')})`;
}

/**
 * One `sandbox unavailable: …` line per agent whose sandbox cannot start;
 * empty when every agent can start (or declares no preflight).
 */
export async function sandboxFailures(
  agents: readonly {
    id: string;
    alias?: string;
    agent: { sandboxPreflight?(): Promise<SandboxPreflight> };
  }[],
): Promise<string[]> {
  const lines: string[] = [];
  for (const { id, alias, agent } of agents) {
    const result = (await agent.sandboxPreflight?.()) ?? { ok: true };
    if (!result.ok) {
      lines.push(
        `sandbox unavailable: ${alias ?? id}: ${result.cause} — ${result.fix} (see https://bakers.build/docs/advanced/run-security#sandbox-prerequisites)`,
      );
    }
  }
  return [...new Set(lines)]; // unaliased entries of one harness report the same line
}
