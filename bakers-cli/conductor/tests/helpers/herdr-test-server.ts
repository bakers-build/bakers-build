/**
 * An isolated, private herdr server for the integration suites (BB-229).
 *
 * WHY — the herdr-backed integration suites used to drive the *developer's*
 * live daemon. Every `herdr … --cwd <tmp>` call selected the suite's throwaway
 * repo as that daemon's ambient context and made herdr materialise a workspace
 * for it; the suite then deleted the repo but never closed the workspace, so
 * stale `bakers-cleanup-* (deleted)` spaces piled up in the user's herdr UI. The
 * fix is not more cleanup — it is that the suites never talk to that daemon at
 * all.
 *
 * HOW — `XDG_CONFIG_HOME` and `HERDR_SOCKET_PATH` are pointed into a single
 * `mkdtemp`, and a `herdr server` is spawned under exactly that environment.
 * The SERVER needs both: given only a socket override it would still load the
 * dev daemon's workspaces, because herdr persists its state in
 * `<config home>/herdr/session.json`. Everything the private daemon owns —
 * socket, session state, config, logs — therefore lives inside that one
 * directory, so teardown is one `rm -rf` and the developer's daemon is
 * untouched *by construction* rather than by cleanup. A CLI CALL, by contrast,
 * needs only the socket to reach that server, which is why the process-wide
 * redirect stays socket-only — see {@link redirectProcessEnv}.
 *
 * THE INVARIANT — no call in these suites may reach the developer's daemon.
 * `isolatedHerdrEnv` enforces it by dropping *every* `HERDR_*` key rather than
 * a hand-maintained list (see its doc comment), and `startIsolatedHerdr`
 * refuses to hand out an environment whose socket is not inside its own temp
 * directory. On a startup timeout it throws with the server's stderr; the one
 * thing it may never do is fall through to the ambient socket.
 *
 * Designed against herdr 0.7.1.
 */
import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

/** Every variable herdr uses to address a daemon starts with this prefix. */
const HERDR_PREFIX = /^HERDR_/;

/** Where the private daemon keeps its state and how the CLI reaches it. */
export interface IsolatedPaths {
  configHome: string;
  socketPath: string;
}

/**
 * Compose the environment for the private daemon and every `herdr` call of a
 * suite. Pure: it never reads or writes `process.env` and never spawns.
 *
 * The scrub is deliberately **prefix-based**, not a deny-list. The installed
 * binary already exports 18+ `HERDR_*` variables (`HERDR_SOCKET_PATH`,
 * `HERDR_CLIENT_SOCKET_PATH`, `HERDR_SESSION`, `HERDR_ENV`, `HERDR_PANE_ID`,
 * `HERDR_TAB_ID`, `HERDR_WORKSPACE_ID`, `HERDR_ACTIVE_*`, `HERDR_CONFIG_PATH`,
 * …) and adds more over time. A list of known names goes stale the day herdr
 * adds one, and the failure mode of a missed variable is silent leakage back
 * into the developer's daemon — exactly the defect this helper removes.
 */
export function isolatedHerdrEnv(
  parent: NodeJS.ProcessEnv,
  { configHome, socketPath }: IsolatedPaths,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(parent)) {
    if (value === undefined) continue;
    if (HERDR_PREFIX.test(key)) continue;
    env[key] = value;
  }
  env.XDG_CONFIG_HOME = configHome;
  env.HERDR_SOCKET_PATH = socketPath;
  return env;
}

let herdrProbe: boolean | undefined;

/**
 * Is a `herdr` binary usable on this host? One probe per process; a failure of
 * any kind means "no". This is the suites' gate — BB-229 replaced the old
 * `HERDR_ENV` gate, which only ever ran the suites where they could do damage.
 */
export function herdrAvailable(): boolean {
  if (herdrProbe === undefined) {
    try {
      execFileSync('herdr', ['--version'], { stdio: 'ignore' });
      herdrProbe = true;
    } catch {
      herdrProbe = false;
    }
  }
  return herdrProbe;
}

/** A running private daemon plus everything needed to talk to it and stop it. */
export interface IsolatedHerdr {
  /** The scrubbed, redirected environment handed to the server. */
  env: Record<string, string>;
  socketPath: string;
  configHome: string;
  /** Run `herdr <args>` against the private daemon; returns stdout. */
  herdr(args: string[]): string;
  /**
   * Also unlink `path` on teardown — including the hard-exit nets, which is the
   * point: a suite's own throwaway fixture (its `mkdtemp` repo) otherwise
   * survives a Ctrl-C, because `afterAll` never runs. Registering it here
   * reuses the ONE net, so the signal is re-raised once rather than per path.
   */
  alsoRemove(path: string): void;
  /** Layered, idempotent teardown. Safe to call more than once. */
  stop(): Promise<void>;
}

/**
 * A minimal config for the private daemon. `herdr --default-config` documents
 * `onboarding`, `[update] version_check` and `manifest_check` as defaulting to
 * true, the latter two reaching herdr.dev in the background — a fresh config
 * dir would otherwise boot a network-dependent, non-deterministic server.
 */
const TEST_CONFIG_TOML = `# Written by bakers's integration suites (BB-229). Not a user config.
onboarding = false

[update]
version_check = false
manifest_check = false

# BB-237: pin the pane shell. Panes otherwise spawn $SHELL — the DEVELOPER's
# interactive shell — inside this daemon's empty XDG_CONFIG_HOME. Measured with
# fish: the pane came up in fish's first-run configuration wizard
# ("Does this look like a diamond … Choice [ynq]:") and silently swallowed the
# command a suite had typed into it, so an open-layout assertion failed with no
# error anywhere. Same class of non-determinism as the version/manifest checks
# above: a test daemon must not depend on the host developer's config.
[terminal]
default_shell = "/bin/sh"
shell_mode = "non_login"
`;

const SOCKET_POLL_MS = 50;
const SOCKET_TIMEOUT_MS = 15_000;
const STOP_RPC_TIMEOUT_MS = 5_000;
const EXIT_GRACE_MS = 5_000;
const SIGTERM_GRACE_MS = 2_000;

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/**
 * Spawn a private herdr server and redirect this process at it.
 *
 * The redirection is applied to the test process's own `process.env` on
 * purpose. `CommandRunner.run` *merges* a caller env over `process.env` and can
 * never *remove* an inherited key, so no per-call `env` option could scrub an
 * ambient `HERDR_PANE_ID`. Mutating the suite's environment redirects every
 * path at once — the tests' own `execFileSync`, `HerdrExecutor`,
 * `HerdrWorkspace` and the `sh -c` lifecycle hooks — and it keeps the
 * *production* default-exec path under test, which is the entire point of a
 * ground-truth integration test. This is safe because the integration runner is
 * pinned to `fileParallelism: false` / `maxWorkers: 1`, so no second file runs
 * concurrently in this process; the exact prior values are restored by `stop()`.
 *
 * Note what is NOT redirected process-wide: `XDG_CONFIG_HOME` (see
 * {@link redirectProcessEnv}). The private state dir stays private to the
 * server; the rest of the suite — a container runtime CLI, `git` — keeps the real one.
 */
export async function startIsolatedHerdr(): Promise<IsolatedHerdr> {
  const stateDir = mkdtempSync(join(tmpdir(), 'bakers-herdr-'));
  const configHome = stateDir;
  const socketPath = join(stateDir, 'herdr.sock');

  mkdirSync(join(configHome, 'herdr'), { recursive: true });
  writeFileSync(join(configHome, 'herdr', 'config.toml'), TEST_CONFIG_TOML);

  const env = isolatedHerdrEnv(process.env, { configHome, socketPath });

  // Refuse to hand out an environment that could still address the dev daemon.
  if (!resolve(socketPath).startsWith(resolve(stateDir) + sep)) {
    rmSync(stateDir, { recursive: true, force: true });
    throw new Error(
      `refusing to start: socket ${socketPath} is outside the isolated state dir ${stateDir}`,
    );
  }

  const child = spawn('herdr', ['server'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr?.on('data', (chunk) => {
    stderr += String(chunk);
  });
  child.stdout?.on('data', () => {
    /* drained so the pipe cannot fill and block the server */
  });
  let exited = false;
  child.on('exit', () => {
    exited = true;
  });

  const hardKill = () => {
    try {
      child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  };

  // Wait for the daemon to bind its socket; never fall back to the ambient one.
  const deadline = Date.now() + SOCKET_TIMEOUT_MS;
  while (!existsSync(socketPath)) {
    if (exited) {
      rmSync(stateDir, { recursive: true, force: true });
      throw new Error(
        `isolated herdr server exited before binding ${socketPath}\n${stderr}`,
      );
    }
    if (Date.now() > deadline) {
      hardKill();
      rmSync(stateDir, { recursive: true, force: true });
      throw new Error(
        `isolated herdr server did not bind ${socketPath} within ${SOCKET_TIMEOUT_MS}ms\n${stderr}`,
      );
    }
    await sleep(SOCKET_POLL_MS);
  }

  const restore = redirectProcessEnv(process.env, socketPath);

  /** The private state dir, plus whatever `alsoRemove` registered. */
  const ownedPaths: string[] = [stateDir];
  const removeOwnedPaths = () => {
    for (const path of ownedPaths) {
      // Restore write permission FIRST. A registered path may contain a
      // Drupal-hardened checkout (`0555 web/sites/default`), and `rmSync`
      // cannot unlink through a read-only directory however `force` is set —
      // it throws EACCES and the tree survives. Synchronous on purpose: this
      // also runs from the `exit` handler, where nothing async would complete.
      try {
        execFileSync('chmod', ['-R', 'u+w', path], { stdio: 'ignore' });
      } catch {
        /* the path may already be gone, or not need it */
      }
      try {
        rmSync(path, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  };

  // Best-effort synchronous net for a hard crash: `afterAll` may never run,
  // but this still leaves no orphan and no residue.
  const onExit = () => {
    hardKill();
    removeOwnedPaths();
  };
  // `exit` alone does NOT cover a signal: Node runs `exit` handlers on a normal
  // exit and on `process.exit()`, but a SIGINT/SIGTERM with no listener
  // terminates the process through its default disposition and skips them
  // entirely. Measured: a Ctrl-C mid-suite left both an orphaned `herdr server`
  // and its `/tmp/bakers-herdr-*` state dir behind. So clean up here, detach, and
  // re-raise so the signal keeps its original meaning for vitest and the shell.
  const onSignal = (signal: NodeJS.Signals) => {
    onExit();
    detachNets();
    process.kill(process.pid, signal);
  };

  function detachNets(): void {
    process.removeListener('exit', onExit);
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  }

  process.on('exit', onExit);
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  let stopped = false;

  return {
    env,
    socketPath,
    configHome,
    herdr(args: string[]): string {
      return execFileSync('herdr', args, { encoding: 'utf8', env });
    },
    alsoRemove(path: string): void {
      ownedPaths.push(path);
    },
    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      // Each step is independently guarded: a failure in one must not skip the
      // next, or a failed assertion mid-suite would leave an orphan behind.
      try {
        execFileSync('herdr', ['server', 'stop'], {
          env,
          stdio: 'ignore',
          timeout: STOP_RPC_TIMEOUT_MS,
        });
      } catch {
        /* the SIGTERM/SIGKILL ladder below is the real guarantee */
      }
      try {
        await waitForExit(child, () => exited, EXIT_GRACE_MS);
        if (!exited) {
          child.kill('SIGTERM');
          await waitForExit(child, () => exited, SIGTERM_GRACE_MS);
        }
        if (!exited) hardKill();
      } catch {
        hardKill();
      }
      try {
        restore();
      } catch {
        /* ignore */
      }
      removeOwnedPaths();
      detachNets();
    },
  };
}

/**
 * Redirect `target` (in practice `process.env`) at the private daemon: drop
 * every ambient `HERDR_*` key, then set `HERDR_SOCKET_PATH`. Returns a restore
 * function that puts back the exact prior value of every key touched —
 * including re-deleting keys that did not exist before.
 *
 * `XDG_CONFIG_HOME` is deliberately NOT redirected here, only in the env handed
 * to the spawned server. The socket alone is what routes a CLI call: verified
 * live — with the ambient `XDG_CONFIG_HOME` and only `HERDR_SOCKET_PATH`
 * overridden, `herdr workspace list` saw the private daemon's workspaces, not
 * the developer's. The config home only decides where the SERVER persists its
 * state, and the server gets it through its own environment.
 *
 * Redirecting it process-wide instead is actively harmful, and not
 * hypothetically: the container runtime CLI writes under `$XDG_CONFIG_HOME`,
 * so the `after_create` hook of worktree-lifecycle.test.ts recreated its
 * config directory inside the temp state dir *after* teardown had
 * unlinked it — leaving exactly the `/tmp/bakers-herdr-*` residue this helper
 * exists to prevent. `git` ($XDG_CONFIG_HOME/git/config) would be next.
 */
export function redirectProcessEnv(
  target: NodeJS.ProcessEnv,
  socketPath: string,
): () => void {
  const touched = new Set<string>([
    ...Object.keys(target).filter((k) => HERDR_PREFIX.test(k)),
    'HERDR_SOCKET_PATH',
  ]);
  const snapshot = new Map<string, string | undefined>();
  for (const key of touched) snapshot.set(key, target[key]);

  for (const key of touched) delete target[key];
  target.HERDR_SOCKET_PATH = socketPath;

  return () => {
    for (const [key, value] of snapshot) {
      if (value === undefined) delete target[key];
      else target[key] = value;
    }
  };
}

/** Resolve once the child has exited, or after `ms` — whichever comes first. */
function waitForExit(
  child: ChildProcess,
  hasExited: () => boolean,
  ms: number,
): Promise<void> {
  if (hasExited()) return Promise.resolve();
  return new Promise<void>((done) => {
    const timer = setTimeout(done, ms);
    child.once('exit', () => {
      clearTimeout(timer);
      done();
    });
  });
}
