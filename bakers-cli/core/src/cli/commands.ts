// BB-201: the command-plugin contract for the `bakers` plugin host. The host
// (`@bakers-build/bakers`) composes three declared, dynamically-resolved command
// packages — `@bakers-build/conductor`, `@bakers-build/ui`, `@bakers-build/addon-dropsh` —
// each default-exporting a `BbCommandPlugin`. The contract lives in core so
// every command package edges only to core (the acyclic guard's plugin rule),
// and `commander` is a TYPE-only import (core carries it as a dep, pinned to a
// single major across the set) so no runtime dependency is added here.
import type { Command } from 'commander';
import type { DropSHPlugin } from 'dropsh/plugin';
import type { BbConnectionConfig } from './load-bakers-config.js';

/**
 * What the host hands each command plugin at mount time. `resolveBases` is the
 * ESLint-style base order the plugin passes to `resolveModuleEslintStyle` for
 * pnpm-safe sibling resolution (renderer, dropsh auth plugins) — the host owns
 * it because only the host knows its own install location; a plugin resolving
 * from its own `import.meta.url` breaks under pnpm's isolated store.
 */
export interface BbCommandHost {
  /** Base dirs/URLs for ESLint-style module resolution: host install → cwd. */
  resolveBases: string[];
  /** Host-owned product-workspace plugin factory for scoped command surfaces. */
  workspacePlugin?: (
    workspaceId: string,
  ) => DropSHPlugin | Promise<DropSHPlugin>;
  /** Conductor-owned project context, supplied by the meta host when present. */
  projectContext?: {
    resolveConfigPath(cwd: string): string;
    readWorkspace(configPath: string): string | undefined;
    writeWorkspace(configPath: string, name: string): Promise<void>;
    resolveContext?(
      configPath: string,
      connection: BbConnectionConfig,
    ): Promise<{ projectId: string; workspaceId: string; workspace: string }>;
  };
}

/**
 * A command plugin the host mounts under its `name` (`bakers <name> …`).
 * `describe` is shown in `bakers --help` even when the plugin is NOT loaded (the
 * host renders a describe-only stub), so lazy mounting keeps `--help` complete.
 * `register` receives the top-level `commander` program and the host; it adds
 * the plugin's subcommand tree.
 */
export interface BbCommandPlugin {
  /** BB-215: the total-tag discriminant — a command plugin self-identifies its
   *  surface, like every other bakers.build plugin carries a `.kind`. */
  readonly kind: 'command';
  name: string;
  describe: string;
  register(program: Command, host: BbCommandHost): void | Promise<void>;
}
