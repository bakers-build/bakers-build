import { execFile } from 'node:child_process';
import { existsSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  type AgentFootprint,
  type AgentPlugin,
  type AgentRunIdentity,
  type BbAgent,
  CONDUCTOR_TOKEN_ENV,
  CONDUCTOR_TOOLS_SERVER,
  ensureHome,
  homeKey,
  homePath,
  installCommand,
  type KnownOptionSpec,
  lastLine,
  type MarketplaceDeclaration,
  type PluginLaunch,
  type ResolvedSecurity,
  type RunEnvPolicy,
  resolveAgentCliOptions,
  resolveSecurityOptions,
  type SandboxHost,
  type SandboxOptions,
  type SandboxPreflight,
  type SecurityMode,
  type SecurityOptions,
  systemSandboxHost,
  validateOptionalBoolean,
} from '@bakers-build/conductor/contract';
import {
  gitSandboxPaths,
  shellQuote,
  withoutGitDirs,
} from '@bakers-build/core';
import {
  parseClaudePermissionDenials,
  parseClaudeTranscript,
} from './footprint.js';

export { parseClaudeTranscript } from './footprint.js';

/** src/index.ts and dist/src/index.js both sit two levels below the package root. */
const MEASURE_WRAPPER = fileURLToPath(
  new URL(
    import.meta.url.includes('/dist/')
      ? '../../measure/claude-measure.mjs'
      : '../measure/claude-measure.mjs',
    import.meta.url,
  ),
);

const TRUST_WRAPPER = fileURLToPath(
  new URL(
    import.meta.url.includes('/dist/')
      ? '../../trust/claude-trust.mjs'
      : '../trust/claude-trust.mjs',
    import.meta.url,
  ),
);

/** Flag → value pairs; a flag the security mode already passes is skipped. */
const MEASURE_FLAGS: readonly (readonly string[])[] = [
  ['--setting-sources', 'project,local'],
  ['--settings', '.bakers/claude-measure.settings.json'],
  ['--strict-mcp-config'],
  ['--mcp-config', '{"mcpServers":{}}'],
];

const SANDBOX_DEFAULTS: Required<SandboxOptions> = {
  // No global tools: whatever a sandboxed run needs beyond its worktree comes through addon tools.
  trusted_commands: [],
  deny_read: ['~/.ssh', '~/.bakers'],
  allow_write: [],
  network: ['*'],
  mcp_servers: {},
};

/** The launch flags a security mode owns (`docs/addons/claude.md`). */
function securityFlags(
  { mode, sandbox, config }: ResolvedSecurity,
  workspacePath: string | undefined,
  configDir: string,
  pluginsOn = false,
): string[] {
  if (mode === 'system') return [];
  if (mode === 'yolo') return ['--dangerously-skip-permissions'];
  if (mode === 'custom') return ['--settings', JSON.stringify(config)];
  // Git metadata only for a known workspace; the conductor always passes one.
  const git =
    workspacePath === undefined
      ? { write: [], protect: [] }
      : gitSandboxPaths(workspacePath);
  const settings = {
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      // Claude matches these like `Bash(...)` rules: a bare `git` is exact
      // and would leave `git status` sandboxed, so a name takes ` *`.
      excludedCommands: sandbox.trusted_commands.map((cmd) =>
        cmd.endsWith('*') ? cmd : `${cmd} *`,
      ),
      filesystem: {
        denyRead: sandbox.deny_read,
        allowWrite: [...sandbox.allow_write, ...git.write],
        denyWrite: git.protect,
      },
      network: { allowedDomains: sandbox.network },
    },
    disableClaudeAiConnectors: true,
    // What is allowed here runs without a prompt; under dontAsk anything
    // else, such as a write outside the worktree or to the protected
    // `.claude/`, is denied at once, since nobody answers a prompt on a box.
    // Every Bash command is either sandboxed or a trusted command, and the
    // Read deny covers the Read tool, which the OS sandbox does not confine.
    permissions: {
      // The conductor's server binds every call to this run's worktree and project.
      // The run's own plugins and skills live in its config dir, outside the worktree;
      // Claude applies Read rules to Glob and Grep as well.
      allow: [
        'Bash',
        'Edit(./**)',
        'AskUserQuestion',
        `mcp__${CONDUCTOR_TOOLS_SERVER}`,
        'Skill',
        `Read(/${join(configDir, 'plugins')}/**)`,
        `Read(/${join(configDir, 'skills')}/**)`,
      ],
      // Claude reads a single leading `/` as relative to the settings file;
      // the plain rule covers a file entry, `/**` a directory's contents.
      deny: sandbox.deny_read.flatMap((path) => {
        const rule = path.startsWith('/') ? `/${path}` : path;
        return [`Read(${rule})`, `Read(${rule}/**)`];
      }),
    },
  };
  return [
    '--permission-mode',
    'dontAsk',
    // The agent home's user settings enable its plugins; the person's own stay out.
    '--setting-sources',
    pluginsOn ? 'user,project,local' : 'project,local',
    '--settings',
    JSON.stringify(settings),
  ];
}

/**
 * Encode an absolute cwd the way Claude Code names its per-project transcript
 * directory under `~/.claude/projects/`: every non-alphanumeric char → `-`.
 */
export function encodeClaudeProjectDir(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

export interface ClaudeAgentOptions extends SecurityOptions {
  model?: string;
  effort?: string;
  args?: string[];
  /**
   * When true, the launch runs through `measure/claude-measure.mjs`, which
   * starts the logging proxy for the lifetime of this Claude process and
   * applies the state-group settings shipped with the addon.
   */
  measure?: boolean;
  /** False runs this agent in the user's own `~/.claude`, without the project's plugins. */
  plugins?: boolean;
}

const run = promisify(execFile);

/** Run `claude <args> --json` in `configDir`; a failure names `what` and the CLI's output. */
async function claudeJson(
  configDir: string,
  what: string,
  args: string[],
): Promise<Record<string, unknown>> {
  try {
    const { stdout } = await run('claude', [...args, '--json'], {
      env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
    });
    return JSON.parse(lastLine(stdout) || '{}');
  } catch (error) {
    const { stderr, stdout, message } = error as {
      stderr?: string;
      stdout?: string;
      message: string;
    };
    throw new Error(
      `${what}: claude ${args.join(' ')} failed: ${(stderr || stdout || message).trim()}`,
    );
  }
}

const CLAUDE_RESERVED = [
  '--session-id',
  '--dangerously-skip-permissions',
  '--allow-dangerously-skip-permissions',
  '--permission-mode',
  '--settings',
  '--setting-sources',
  '--strict-mcp-config',
  '--mcp-config',
] as const;

const CLAUDE_KNOWN: readonly KnownOptionSpec[] = [
  { kind: 'model', flags: ['--model'] },
  { kind: 'effort', flags: ['--effort'] },
];

export class ClaudeAgent implements BbAgent {
  readonly id = 'claude';
  private readonly args: string[];
  private readonly model: string | undefined;
  private readonly effort: string | undefined;
  readonly security: ResolvedSecurity;
  /** The sandbox's own MCP servers, strict; undefined outside the sandbox. */
  private readonly sandboxMcpServers: Record<string, unknown> | undefined;
  private readonly securityMode: SecurityMode;
  readonly runEnvPolicy: RunEnvPolicy;
  /** Set by the last launch: the conductor's server replaced the sandbox's own `bakers`. */
  private replacedBakersServer = false;
  private readonly measure: boolean;
  private readonly overrides: { model: boolean; effort: boolean };
  readonly pluginsDisabled: boolean;
  /** The Claude config dir runs read and write: the agent home while plugins are on. */
  configDir: string;
  private pluginsOn = false;

  constructor(
    options: ClaudeAgentOptions = {},
    private readonly home: string = homedir(),
  ) {
    const cli = resolveAgentCliOptions(options, CLAUDE_RESERVED, CLAUDE_KNOWN);
    this.args = cli.args;
    this.model = cli.model;
    this.effort = cli.effort;
    this.overrides = cli.overrides;
    const security = resolveSecurityOptions(options, SANDBOX_DEFAULTS);
    this.security = {
      ...security,
      sandbox: {
        ...security.sandbox,
        allow_write: withoutGitDirs(security.sandbox.allow_write),
      },
    };
    this.sandboxMcpServers =
      security.mode === 'sandbox' ? security.sandbox.mcp_servers : undefined;
    this.securityMode = security.mode;
    this.runEnvPolicy = security.runEnvPolicy;
    this.measure = validateOptionalBoolean(options.measure, 'measure') ?? false;
    this.pluginsDisabled =
      validateOptionalBoolean(options.plugins, 'plugins') === false;
    this.configDir = join(home, '.claude');
  }

  /** Point this agent at the agent home of the project's declared marketplaces. */
  useMarketplaces(marketplaces: readonly MarketplaceDeclaration[]): void {
    if (this.pluginsDisabled || marketplaces.length === 0) return;
    this.pluginsOn = true;
    this.configDir = homePath(this.id, homeKey([...marketplaces]));
  }

  async installPlugins(
    marketplaces: readonly MarketplaceDeclaration[],
    home: string,
  ): Promise<PluginLaunch> {
    const outcome = await ensureHome(home, async (dir) => {
      const credentials = join(this.home, '.claude', '.credentials.json');
      if (!existsSync(credentials))
        throw new Error(
          `claude: no credential file at ${credentials} (a keychain login cannot be shared with an agent home); log in with a file-based credential`,
        );
      symlinkSync(credentials, join(dir, '.credentials.json'));
      for (const { url, ref, plugins } of marketplaces) {
        const added = await claudeJson(dir, url, [
          'plugin',
          'marketplace',
          'add',
          `${url}#${ref}`,
        ]);
        for (const plugin of plugins)
          await claudeJson(dir, plugin, [
            'plugin',
            'install',
            `${plugin}@${String(added.marketplace)}`,
          ]);
      }
      // Skip the first-run onboarding; the CLI wrote the rest of this file.
      const state = join(dir, '.claude.json');
      const seeded = existsSync(state)
        ? JSON.parse(readFileSync(state, 'utf8'))
        : {};
      writeFileSync(
        state,
        `${JSON.stringify({ ...seeded, hasCompletedOnboarding: true }, null, 2)}\n`,
        { mode: 0o600 },
      );
    });
    return { env: { CLAUDE_CONFIG_DIR: home }, args: [], home: outcome };
  }

  get launchWarnings(): readonly string[] {
    return this.replacedBakersServer
      ? [
          `sandbox.mcp_servers.${CONDUCTOR_TOOLS_SERVER} is replaced by the conductor's ${CONDUCTOR_TOOLS_SERVER} server`,
        ]
      : [];
  }

  /** A measured run stays without the conductor's tools, MCP or bridge. */
  get withoutConductorTools(): boolean {
    return this.measure;
  }

  launchCommand(
    prompt: string,
    run?: AgentRunIdentity,
    workspacePath?: string,
    tools?: { url: string },
    _env?: Readonly<Record<string, string>>,
    pluginArgs: readonly string[] = [],
  ): string {
    if (prompt === '') {
      return 'claude';
    }
    return this.command(
      this.measure
        ? ['node', shellQuote(MEASURE_WRAPPER), 'claude', shellQuote(prompt)]
        : ['claude', shellQuote(prompt)],
      run,
      workspacePath,
      tools,
      pluginArgs,
    );
  }

  /**
   * `claude --resume <id>` with the launch's own flags, so a run whose pane
   * died continues its conversation. Not for a measured run: its wrapper
   * profiles one fresh session.
   */
  resumeCommand(
    sessionId: string,
    workspacePath?: string,
    tools?: { url: string },
    _env?: Readonly<Record<string, string>>,
    pluginArgs: readonly string[] = [],
  ): string | undefined {
    if (this.measure) return undefined;
    return this.command(
      ['claude', '--resume', shellQuote(sessionId)],
      undefined,
      workspacePath,
      tools,
      pluginArgs,
    );
  }

  private command(
    head: string[],
    run: AgentRunIdentity | undefined,
    workspacePath: string | undefined,
    tools: { url: string } | undefined,
    pluginArgs: readonly string[],
  ): string {
    // Wait for project-declared plugins (extraKnownMarketplaces) to install
    // before the first turn; a fresh worktree otherwise starts without them.
    // A new worktree path would stop the run at Claude Code's trust dialog.
    // With plugins on, the agent home already holds the installed plugins.
    const parts = [
      ...(this.pluginsOn ? [] : ['CLAUDE_CODE_SYNC_PLUGIN_INSTALL=1']),
      ...(workspacePath
        ? ['node', shellQuote(TRUST_WRAPPER), shellQuote(workspacePath)]
        : []),
      ...head,
    ];
    if (this.model !== undefined && !this.overrides.model) {
      parts.push('--model', shellQuote(this.model));
    }
    if (this.effort !== undefined && !this.overrides.effort) {
      parts.push('--effort', shellQuote(this.effort));
    }
    // The flags are constants; only their generated values need quoting.
    parts.push(
      ...[
        ...securityFlags(
          this.security,
          workspacePath,
          this.configDir,
          this.pluginsOn,
        ),
        ...this.mcpFlags(tools),
      ].map((t) => (t.startsWith('--') ? t : shellQuote(t))),
    );
    // Pin the transcript's own session id to the run's UUID (BB-473), so
    // `getRunLog` can read that ONE file directly instead of scanning the
    // worktree-keyed directory by mtime — the scan is what let a
    // resumed/re-dispatched/reused worktree finalise a foreign transcript.
    if (run?.sessionId) {
      parts.push('--session-id', run.sessionId);
    }
    parts.push(...pluginArgs.map(shellQuote), ...this.args.map(shellQuote));
    if (this.measure) {
      // The wrapper folds an inline --settings JSON into its profile file.
      for (const pair of MEASURE_FLAGS) {
        if (!parts.includes(pair[0] as string)) {
          parts.push(...pair.map(shellQuote));
        }
      }
    }
    return parts.join(' ');
  }

  /**
   * The sandbox's strict MCP config, plus the conductor's tool server when
   * the run has one. A measured run stays without MCP servers. The token is
   * referenced from the run env, which Claude expands, so it is never in argv.
   */
  private mcpFlags(tools: { url: string } | undefined): string[] {
    const conductor =
      tools && !this.measure
        ? {
            [CONDUCTOR_TOOLS_SERVER]: {
              type: 'http',
              url: tools.url,
              headers: { Authorization: `Bearer \${${CONDUCTOR_TOKEN_ENV}}` },
            },
          }
        : {};
    this.replacedBakersServer =
      CONDUCTOR_TOOLS_SERVER in conductor &&
      Object.hasOwn(this.sandboxMcpServers ?? {}, CONDUCTOR_TOOLS_SERVER);
    const config = (servers: Record<string, unknown>) =>
      JSON.stringify({ mcpServers: servers });
    if (this.sandboxMcpServers !== undefined)
      return [
        '--strict-mcp-config',
        '--mcp-config',
        config({ ...this.sandboxMcpServers, ...conductor }),
      ];
    return Object.keys(conductor).length > 0
      ? ['--mcp-config', config(conductor)]
      : [];
  }

  /**
   * `claude --session-id <uuid>` refuses to start when that session already
   * exists (BB-473 review round 2), so the conductor checks this before
   * pinning the run's own UUID — a re-dispatch of the same run would
   * otherwise mint the very id its first attempt already wrote and fail to
   * launch at all, silently (`claude` exits 0 on that error).
   */
  async sessionExists(
    worktreePath: string,
    sessionId: string,
  ): Promise<boolean> {
    const dir = join(
      this.configDir,
      'projects',
      encodeClaudeProjectDir(worktreePath),
    );
    try {
      await stat(join(dir, `${sessionId}.jsonl`));
      return true;
    } catch {
      return false;
    }
  }

  /** The run's pinned transcript only: the newest existing attempt, as {@link getRunLog} prefers it. */
  async runLogModified(
    worktreePath: string,
    run: AgentRunIdentity,
  ): Promise<number | undefined> {
    const dir = join(
      this.configDir,
      'projects',
      encodeClaudeProjectDir(worktreePath),
    );
    const names = run.attemptFamily?.length
      ? [...run.attemptFamily].reverse()
      : [run.sessionId];
    for (const name of names) {
      try {
        return (await stat(join(dir, `${name}.jsonl`))).mtimeMs;
      } catch {
        // try the next, lower-numbered attempt.
      }
    }
    return undefined;
  }

  async getRunLog(
    worktreePath: string,
    run?: AgentRunIdentity,
  ): Promise<string> {
    const dir = join(
      this.configDir,
      'projects',
      encodeClaudeProjectDir(worktreePath),
    );
    const startedAtMs =
      run?.startedAt !== undefined ? new Date(run.startedAt).getTime() : null;
    // BB-473: when the run's own session id is known (pinned at launch via
    // `--session-id`), read that file directly — no directory scan, so a
    // foreign transcript (resumed run, re-dispatch, reused worktree) can
    // never be selected. AC-5: when the pinned file is missing (a run
    // dispatched before this change, or the agent never wrote it), fall
    // through to the scan below — bounded by `run.startedAt` where known —
    // instead of returning '' and turning a wrong log into no log at all.
    //
    // Round 4 (review round 3, Critical 1): the pinned file can also be
    // *stale* rather than missing — a re-dispatch omits `--session-id` (see
    // `sessionExists`) precisely because attempt 1's file already owns this
    // name, so a direct read here would silently keep returning attempt 1's
    // transcript forever. `startedAt` is re-stamped by the conductor on
    // every dispatch (`markRunning`), so a pinned file older than this
    // attempt's own start can only be a leftover from a prior attempt —
    // reject it and fall through to the scan, which is bounded by the same
    // timestamp and will find the fresh, unpinned file this attempt wrote.
    // BB-473 review round 4 (Critical 2): when the run's deterministic
    // attempt family is known, select the HIGHEST-numbered attempt whose
    // file actually exists — an IDENTITY, not the `startedAt` window below,
    // which a sibling session newer than the bound could still beat. Each
    // family member names a distinct attempt, so no staleness check is
    // needed: whichever member exists IS that attempt's own transcript.
    if (run?.attemptFamily?.length) {
      for (let i = run.attemptFamily.length - 1; i >= 0; i--) {
        try {
          return await readFile(
            join(dir, `${run.attemptFamily[i]}.jsonl`),
            'utf8',
          );
        } catch {
          // try the next, lower-numbered attempt.
        }
      }
      // AC-5: none of the family's files exist yet — a run dispatched before
      // this change, or the agent never wrote its pinned file — so fall
      // through to the scan below instead of returning ''.
    } else if (run?.sessionId) {
      try {
        const path = join(dir, `${run.sessionId}.jsonl`);
        const isStale =
          startedAtMs !== null &&
          Number.isFinite(startedAtMs) &&
          (await stat(path)).mtimeMs < startedAtMs;
        if (!isStale) {
          return await readFile(path, 'utf8');
        }
      } catch {
        // fall through to the scan.
      }
    }
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return '';
    }
    let latest: { path: string; mtimeMs: number } | null = null;
    for (const name of entries) {
      if (!name.endsWith('.jsonl')) {
        continue;
      }
      const full = join(dir, name);
      try {
        const s = await stat(full);
        if (
          startedAtMs !== null &&
          Number.isFinite(startedAtMs) &&
          s.mtimeMs < startedAtMs
        ) {
          continue;
        }
        if (!latest || s.mtimeMs > latest.mtimeMs) {
          latest = { path: full, mtimeMs: s.mtimeMs };
        }
      } catch {
        // entry vanished between readdir and stat — skip.
      }
    }
    if (!latest) {
      return '';
    }
    try {
      return await readFile(latest.path, 'utf8');
    } catch {
      return '';
    }
  }

  parseFootprint(log: string): AgentFootprint {
    return parseClaudeTranscript(log);
  }

  /** Only the sandbox launches in `dontAsk`; other modes are never reported. */
  permissionDenials(log: string): string[] {
    if (this.securityMode !== 'sandbox') return [];
    return parseClaudePermissionDenials(log);
  }

  /** Linux needs bwrap, socat and a user namespace; macOS ships Seatbelt. */
  async sandboxPreflight(
    host: SandboxHost = systemSandboxHost(),
  ): Promise<SandboxPreflight> {
    if (this.securityMode !== 'sandbox' || host.platform !== 'linux') {
      return { ok: true };
    }
    const missing = [
      ['bwrap', 'bubblewrap'],
      ['socat', 'socat'],
    ].filter(([bin]) => !host.onPath(bin as string));
    if (missing.length > 0) {
      return {
        ok: false,
        cause: `${missing.map(([bin]) => bin).join(' and ')} not found`,
        fix: `install it with ${installCommand(
          host,
          missing.map(([, pkg]) => pkg as string),
        )}`,
      };
    }
    // The namespaces Claude's sandbox needs: user (unprivileged) and net.
    const probe = await host.run('bwrap', [
      '--unshare-user',
      '--unshare-net',
      '--die-with-parent',
      '--ro-bind',
      '/',
      '/',
      'true',
    ]);
    return probe.ok
      ? { ok: true }
      : {
          ok: false,
          cause: `bwrap cannot set up its sandbox: ${lastLine(probe.stderr)}`,
          fix: 'allow unprivileged user namespaces on this host, or run the conductor where they are allowed',
        };
  }
}

/** Config-facing factory: `claudeAgent({ model: 'claude-opus-4-8' })`. */
export function claudeAgent(options: ClaudeAgentOptions = {}): AgentPlugin {
  const agent = new ClaudeAgent(options);
  return {
    kind: 'agent',
    id: 'claude',
    requiredModules: [],
    permissions: agent.security.report,
    async createAgent(config) {
      agent.useMarketplaces(config.marketplaces ?? []);
      return agent;
    },
  };
}

// Default export: this module also exports the `ClaudeAgent` class, so the
// config resolver's auto-pick (no `export:`) sees 2 function exports and
// would otherwise throw "specify export" — see conductor/src/config.ts
// `loadNamedPlugin`. The default export makes the factory win.
export default claudeAgent;
