// BB-201 (was BB-194), BB-219: bootstrap builders for `bakers ui`. Pure
// functions that turn the machine context (identity), the conductor registry
// and the cwd into everything `runBbUi` needs. The CONNECTION itself is not
// built here — `ui.ts` asks core's `loadBbConfig` for it, so this package
// holds no connection-precedence rule of its own (AC-6).
import { dirname, resolve } from 'node:path';
import {
  findProjectBbDir,
  homeBbDir,
  type MachineContext,
  shellQuote,
} from '@bakers-build/core';

/**
 * The resolved control-plane connection passed to the renderer launcher.
 * A structural mirror of `@bakers-build/addon-bakers-ui`'s `HomeConnection` — kept
 * local so this package needs NO compile-time dependency on the renderer (it
 * resolves the renderer dynamically, ESLint-style, at runtime).
 */
export interface HomeConnection {
  baseUrl: string;
  jsonapiPrefix?: string | undefined;
  authPlugins: unknown[];
  configPath?: string | undefined;
}
// BB-391: the two read/write auth-profile members are gone. A connection used
// to declare two dropsh auth profiles that differed only by OAuth scope, and the
// cockpit had to name one for reads and one for writes; BB-359 moved capability
// onto OG ranks, so both resolved to the same role. The connection now declares
// ONE default provider and nothing has to choose. AC2's grep over
// `bakers-cli/*/src` is the guard, so the retired names are not spelled here.

/**
 * Resolve the agent-launch command builder from the home config. Turns a TUI
 * prompt into the shell command herdr runs. Defaults to `claude` (an empty
 * prompt yields the bare launch command). A machine context may name a
 * different `agent_command` binary.
 */
export function resolveAgentCommand(
  machine: Partial<MachineContext> & { agent_command?: string },
): (prompt: string) => string {
  const bin = (machine.agent_command ?? '').trim() || 'claude';
  return (prompt: string) =>
    prompt.trim() === '' ? bin : `${bin} ${shellQuote(prompt)}`;
}

/** Where `bakers ui` roots the agents it launches, and which project they belong to. */
export interface ProjectRooting {
  cwd: string;
  /**
   * The `.bakers` dir of the project we are standing in, when there is one.
   *
   * The ui hands this over rather than a resolved project name: matching it
   * against a conductor's `workspace_root` needs the control plane, and the
   * client that reaches it first exists in the renderer (BB-232). Undefined
   * outside any project.
   */
  bakersDir?: string | undefined;
}

/**
 * Decide the agents' working directory (BB-219 AC-9).
 *
 * The trigger is the **cwd**, deliberately not the winning connection config:
 * "which connection did we resolve" and "which project am I standing in" are
 * different questions, and binding them would let an explicit `--config`
 * silently relocate the agents' working directory.
 *
 * Standing **in** a project (core's walk-up finds a `.bakers/` project dir that
 * is not the user's own `~/.bakers`), the cwd is that repo's **root**. Otherwise
 * the agents root at the home dir and the cockpit opens with no default group —
 * an honest empty cockpit rather than a guess.
 *
 * The project name and this machine's conductor id used to come from a local
 * registry file, which BB-232 deleted. Both now resolve in the renderer's
 * `run()` — `Entity/conductor/Data/own-conductor.ts`, reached through the
 * launcher's `bakersDir` — from the conductor record whose `workspace_root`
 * equals this dir: the same data, from the store that also knows whether the
 * conductor is alive, and matched by the same exact normalised path comparison
 * the registry lookup used.
 *
 * The marker is core's `findProjectBbDir` — "is there a `.bakers/` here" —
 * NOT the connection walk-up `findBbConfig`. Since BB-230 the latter skips
 * an engine-only `conductor.config.js`, which BB-218 makes the canonical repo
 * shape, so keying on it would leave the most common project rooted at home.
 *
 * `~/.bakers` is excluded for the same reason core labels it `home`: the walk-up
 * reaches it from every directory under `$HOME`, so counting it would make
 * every such directory look like "a project rooted at `$HOME`".
 *
 * Pure with respect to precedence — the walk-up is core's; this helper owns no
 * filesystem probe of its own.
 */
export function resolveProjectRooting(
  cwd: string,
  homeDir: string,
): ProjectRooting {
  const bakersDir = findProjectBbDir(cwd);
  // Core owns where `.bakers` lives; the ui never spells the path itself. No
  // argument here: `homeDir` is the fallback cwd (the OS home), not the
  // `.bakers` root, and an explicit argument would beat BB_HOME by design.
  const homeDotBb = resolve(homeBbDir());

  if (bakersDir !== undefined && resolve(bakersDir) !== homeDotBb) {
    return { cwd: dirname(bakersDir), bakersDir };
  }

  return { cwd: homeDir };
}
