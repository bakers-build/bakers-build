import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import type { ConfigPlanOptions } from '@bakers-build/conductor/config';
import type {
  BbCommandHost,
  BbConnectionSelection,
  ConfigOperation,
  ConfigReport,
} from '@bakers-build/core';
import {
  homeBbDir,
  readConfigAddons,
  reportLoadedBbConfigFields,
  resolveBbConnectionSelection,
  scopeAddons,
} from '@bakers-build/core';
import { type Command, Option } from 'commander';

export interface ConfigCommandDeps {
  cwd?: string;
  home?: string;
  isTTY?: boolean;
  env?: NodeJS.ProcessEnv;
  host?: BbCommandHost;
  stdout?: (text: string) => void;
  prompt?: (label: string, secret?: boolean) => Promise<string>;
  stateDir?: string;
}
interface ConfigOptions {
  scope?: string;
  format: 'text' | 'json';
  path?: string;
  project?: string;
  machinePath?: string;
  config?: string;
  connection?: string;
  yes?: boolean;
  online?: boolean;
  dryRun?: boolean;
  projectConnection?: string;
  label?: string;
  baseUrl?: string;
  clientId?: string;
  workspaceId?: string;
  workspace?: string;
  secretEnv?: string;
  authType?: 'client_credentials' | 'device';
  afterCreate?: string;
  afterDone?: string;
}

/** Terminal-only input. Secret characters are never echoed. */
async function promptInput(label: string, secret = false): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
    terminal: true,
  });
  const terminal = rl as typeof rl & { _writeToOutput: (text: string) => void };
  let muted = false;
  terminal._writeToOutput = (text) => {
    if (!muted) process.stderr.write(text);
  };
  try {
    return await new Promise<string>((resolve, reject) => {
      rl.once('SIGINT', () => reject(new Error('cancelled')));
      rl.question(`${label}: `, (answer) => {
        if (secret) process.stderr.write('\n');
        resolve(answer.trim());
      });
      muted = secret;
    });
  } finally {
    rl.close();
  }
}

const SCOPE_FILE = {
  machine: '~/.bakers/machine.config.js',
  project: '.bakers/project.config.js',
} as const;

/**
 * Report each machine/project `addons[]` entry listed in a scope its addon
 * does not declare. Resolving an addon imports its preset, so an offline
 * check (which never imports source) only notes that it skipped this.
 */
async function checkAddonScopes(
  report: ConfigReport,
  online: boolean,
  cwd: string,
): Promise<void> {
  const files = report.files.filter(
    (f) =>
      f.selected &&
      f.state !== 'absent' &&
      (f.kind === 'machine' || f.kind === 'project'),
  );
  if (files.length === 0) return;
  const base = {
    stage: 'schema' as const,
    key: 'addons',
    related: [],
    statically_determined: false,
    recheck: 'bakers config check --scope all --online',
  };
  if (!online) {
    report.findings.push({
      ...base,
      code: 'addon_scope_skipped',
      severity: 'info',
      path: (files[0] as (typeof files)[number]).path,
      expected: 'Each addon is listed only in a scope it declares.',
      observed: null,
      owner: (files[0] as (typeof files)[number]).layer,
      remediation:
        'Addon scopes are not checked offline; run bakers config check --online to resolve each addons[] entry.',
    });
    return;
  }
  const hostBases = [import.meta.url];
  const { findings } = await scopeAddons(
    await Promise.all(
      files.map(async (f) => ({
        scope:
          f.kind === 'machine' ? ('machine' as const) : ('project' as const),
        path: f.path,
        entries: await readConfigAddons(f.path),
        bases: [
          pathToFileURL(`${dirname(f.path)}/`).href,
          ...(f.kind === 'machine' ? [] : [pathToFileURL(`${cwd}/`).href]),
          ...hostBases,
        ],
      })),
    ),
    { unresolved: 'skip', logger: { warn: () => {} } as never },
  );
  for (const finding of findings) {
    const allowed = finding.allowed.map((s) => SCOPE_FILE[s]).join(' or ');
    report.findings.push({
      ...base,
      code: 'addon_scope_not_allowed',
      severity: 'error',
      path: finding.path,
      expected: `'${finding.spec}' may be configured only in ${allowed}.`,
      observed: finding.spec,
      owner: finding.scope,
      remediation: `Move '${finding.spec}' from addons[] of ${finding.path} to addons[] of ${allowed}.`,
    });
  }
  if (findings.length > 0 && report.result !== 'failed')
    report.result = 'blocked';
}

/** `, N values not checked`: a passing result never hides what it skipped. */
function notCheckedSummary(report: ConfigReport): string {
  const count = report.findings.filter(
    (f) => f.code === 'not_checked' || f.code === 'options_not_checked',
  ).length;
  return count ? `, ${count} value${count === 1 ? '' : 's'} not checked` : '';
}

export function renderConfigReport(
  report: ConfigReport,
  dryRun = false,
): string {
  const lines = [
    `bakers config ${report.operation}: ${report.result}${notCheckedSummary(report)}${dryRun ? ' (dry run; no files written)' : ''}`,
    `Scope: ${report.resolved_scopes.join(', ')}`,
    `Machine root: ${report.roots.machine}`,
    `Connection root: ${report.roots.connection}`,
    `Project root: ${report.roots.project ?? 'not applicable'}`,
  ];
  for (const file of report.files.filter((file) => file.selected))
    lines.push(
      `${file.layer}: ${file.path} (${file.state}; schema ${file.version.effective ?? 'unversioned'} → ${file.version.current ?? 'unversioned'}; ${file.fingerprint ?? 'absent'})`,
    );
  if (report.machine_policy) {
    const { tunnel, source } = report.machine_policy;
    lines.push(
      `Machine tunnel: ${tunnel === null ? 'unresolved' : tunnel} (from ${source})`,
    );
  }
  if (report.executor_source)
    lines.push(`Executor: from ${report.executor_source}`);
  if (report.connection_resolution) {
    const selected = report.connection_resolution;
    lines.push(
      `Connection: ${selected.id} (${selected.selected_by}) — ${selected.path}`,
    );
    for (const field of selected.fields)
      lines.push(
        `  ${field.key}: ${String(field.value)} (from ${field.source})`,
      );
  }
  for (const change of report.changes)
    lines.push(
      `${change.path}: schema ${change.before_version ?? 'absent/unversioned'} → ${change.after_version ?? 'unversioned'}\n${change.diff}`,
    );
  for (const finding of report.findings)
    lines.push(
      `${finding.severity} ${finding.code}: ${finding.path}${finding.key ? ` [${finding.key}]` : ''}\n  ${finding.expected}\n  ${finding.remediation}\n  Recheck: ${finding.recheck}`,
    );
  lines.push(
    `Offline: ${report.verification.offline.status}. Online: ${report.verification.online.status} — ${report.verification.online.reason}`,
  );
  if (report.operation === 'init' && report.result !== 'ok')
    lines.push(
      'Setup incomplete. Prepared files remain available for repair; inspect the file states above.',
    );
  if (
    report.operation === 'upgrade' &&
    report.verification.readiness === 'unverified'
  )
    lines.push(
      'Connection readiness is unverified; successful migration does not verify server access.',
    );
  return `${lines.join('\n')}\n`;
}

/**
 * Attaches one `config <operation>` command to `parent` (either the `config`
 * group or, for the `bakers init` shortcut, `program` itself). `hiddenScope`
 * exists only for that shortcut: `bakers init` resolves to machine + connection
 * without ever showing `--scope` or its value anywhere (not in `--help`, not
 * in a default), since a human running `bakers init` never chooses or sees a
 * scope at all — while `bakers config init` keeps asking for one (or requiring
 * `--scope` explicitly) exactly as before.
 */
function buildConfigCommand(
  parent: Command,
  operation: ConfigOperation,
  deps: ConfigCommandDeps,
  hiddenScope?: string,
  description?: string,
): void {
  {
    const command = parent
      .command(operation)
      .description(
        description ??
          (operation === 'init'
            ? 'initialize or repair selected configuration and verify readiness'
            : operation === 'upgrade'
              ? 'migrate selected configuration without changing existing values'
              : 'validate configuration offline; optionally verify online access'),
      )
      .option(
        '--scope <scope>',
        'machine | connection | project | all; init requires a scope',
      )
      .addOption(
        new Option('--format <format>', 'report format; JSON disables prompts')
          .choices(['text', 'json'])
          .default('text'),
      )
      .option('--path <directory>', 'project root only')
      .option('--project <name>', 'explicit project name for initialization')
      .option('--machine-path <file>', 'override machine configuration path')
      .option(
        '--config <file>',
        'override global connection configuration path',
      )
      .option(
        '--connection <id>',
        'named connection from ~/.bakers/connections',
      )
      .option('--yes', 'disable prompts and automatic selections')
      .option(
        '--online',
        'authenticate and verify each selected workspace (project scopes); resolve addons[] entries to check their scopes',
      );
    if (operation !== 'check')
      command
        .option(
          '--dry-run',
          'report planned changes without imports, network or writes',
        )
        .addOption(
          new Option(
            '--project-connection <choice>',
            'retired; use --connection',
          ),
        )
        .option(
          '--label <name>',
          'machine display label (default: the short hostname)',
        )
        .option('--base-url <url>', 'connection server URL')
        .option('--client-id <id>', 'OAuth client identifier')
        .option('--workspace-id <uuid>', 'explicit workspace UUID')
        .option('--workspace <name>', 'committed project workspace name')
        .option(
          '--secret-env <name>',
          'environment variable containing the OAuth secret',
        )
        .option(
          '--after-create <command>',
          "committed conductor config's after_create hook; empty means none, bakers-cli names no provisioning tool",
        )
        .option(
          '--after-done <command>',
          "committed conductor config's after_done hook; empty means none, bakers-cli names no provisioning tool",
        )
        .addOption(
          new Option(
            '--auth-type <type>',
            'sign in with device code (default, no secret) or a client secret (internal/CI)',
          ).choices(['client_credentials', 'device']),
        );
    command.action(async (options: ConfigOptions) => {
      if (hiddenScope !== undefined && options.scope === undefined)
        options.scope = hiddenScope;
      const { applyConfigPlan, planConfig } = await import(
        '@bakers-build/conductor/config'
      );
      if (options.projectConnection !== undefined)
        throw new Error(
          '--project-connection is retired; use --connection <id> or BAKERS_CONNECTION.',
        );
      const cwd = deps.cwd ?? process.cwd();
      const env = deps.env ?? process.env;
      const interactive =
        (deps.isTTY ?? Boolean(process.stdin.isTTY && process.stdout.isTTY)) &&
        !options.yes &&
        !options.dryRun &&
        !env.CI &&
        options.format !== 'json';
      const prompt = deps.prompt ?? promptInput;
      let cancelled = false;
      if (operation === 'init' && !options.scope && interactive) {
        try {
          options.scope = await prompt(
            'Configuration scope (machine, connection, project, all)',
          );
        } catch {
          cancelled = true;
        }
      }
      const inputs: NonNullable<ConfigPlanOptions['inputs']> = {};
      for (const key of [
        'label',
        'baseUrl',
        'clientId',
        'workspaceId',
        'workspace',
      ] as const) {
        const value = options[key];
        if (value !== undefined) inputs[key] = value;
      }
      // Without a terminal to ask, the machine label is the short hostname.
      const defaultLabel = hostname().split('.')[0];
      if (!interactive && inputs.label === undefined && defaultLabel)
        inputs.label = defaultLabel;
      const secret = options.secretEnv ? env[options.secretEnv] : undefined;
      if (secret !== undefined) inputs.secret = secret;
      if (options.authType)
        inputs.authType =
          options.authType === 'client_credentials'
            ? 'oauth2_client_credentials'
            : 'oauth2_device_code';
      if (options.afterCreate !== undefined || options.afterDone !== undefined)
        inputs.hooks = {
          ...(options.afterCreate ? { after_create: options.afterCreate } : {}),
          ...(options.afterDone ? { after_done: options.afterDone } : {}),
        };
      const planning: ConfigPlanOptions = {
        operation,
        cwd,
        // Only forward an explicitly injected home; absent, core resolves the
        // `.bakers` root itself and honours BAKERS_HOME.
        ...(deps.home !== undefined ? { home: deps.home } : {}),
        inputs,
        // Addon option schemas resolve from this CLI install, as the loader's do.
        addonBases: [import.meta.url],
        // `bakers init` (hiddenScope !== undefined) never pulls the project
        // layer in, even inside a project checkout (BB-496 finding 1).
        ...(hiddenScope !== undefined ? { excludeProjectLayer: true } : {}),
      };
      for (const key of ['scope', 'path', 'project', 'machinePath'] as const) {
        const value = options[key];
        if (value !== undefined) planning[key] = value;
      }
      if (options.config !== undefined)
        planning.connectionPath = options.config;
      else if (options.connection !== undefined) {
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(options.connection))
          throw new Error(
            '--connection must be an identifier containing letters, numbers, dot, underscore or hyphen.',
          );
        planning.connectionPath = join(
          homeBbDir(deps.home),
          'connections',
          `${options.connection}.js`,
        );
      }
      let selectedConnection: BbConnectionSelection | undefined;
      const initializesNamedConnection =
        operation === 'init' &&
        options.connection !== undefined &&
        ['connection', 'all'].includes(options.scope ?? '');
      if (!initializesNamedConnection && options.scope !== 'machine') {
        selectedConnection = await resolveBbConnectionSelection({
          cwd,
          // Only forward an explicitly injected home; absent, core resolves
          // the `.bakers` root itself and honours BAKERS_HOME (same rule as the
          // `planning` object above — a stray `?? homedir()` here would
          // resolve this command's connection selection under `~/.bakers` while
          // the rest of it honours the override).
          ...(deps.home !== undefined ? { home: deps.home } : {}),
          env,
          ...(options.config ? { explicit: options.config } : {}),
          ...(options.connection ? { connection: options.connection } : {}),
        });
        planning.connectionPath = selectedConnection.path;
      }
      let plan = planConfig(planning);
      if (
        operation === 'init' &&
        options.project &&
        !options.path &&
        ['project', 'all'].includes(options.scope ?? '') &&
        !plan.report.roots.project
      ) {
        planning.path = cwd;
        plan = planConfig(planning);
      }
      const freshConnection =
        operation === 'init' &&
        plan.report.resolved_scopes.includes('connection') &&
        plan.report.files.some(
          (file) =>
            file.kind === 'connection' &&
            file.selected &&
            file.state === 'absent',
        );
      // No sign-in question: device code is the only way `bakers config init`
      // offers (BB-496). `--auth-type client_credentials` remains for the
      // internal/CI path but is never interviewed for or invented outside
      // it — this default applies whether or not a terminal is attached, so
      // a non-interactive `bakers init --yes` gets the same secret-free
      // connection an interactive run does. A caller who already supplied a
      // secret (`--secret-env`) evidently wants client_credentials and is
      // left alone rather than silently switched to device code.
      if (
        freshConnection &&
        inputs.authType === undefined &&
        inputs.secret === undefined
      ) {
        inputs.authType = 'oauth2_device_code';
        plan = planConfig(planning);
      }
      if (
        interactive &&
        operation !== 'check' &&
        !cancelled &&
        !plan.report.findings.some((f) => f.stage === 'scope')
      ) {
        const deviceCode = inputs.authType === 'oauth2_device_code';
        const fields = (
          [
            ['label', 'label', 'Machine label'],
            ['baseUrl', 'site.base_url', 'Server base URL'],
            ['clientId', 'client_id', 'OAuth client identifier'],
            ['secret', 'client_secret', 'OAuth client secret'],
            ['workspaceId', 'workspace_id', 'Workspace UUID'],
            ['workspace', 'project.workspace', 'Workspace name'],
          ] as const
        ).filter(([input]) => !(deviceCode && input === 'secret'));
        for (const [input, key, label] of fields) {
          const requiredForFreshConnection =
            freshConnection &&
            (deviceCode
              ? ['baseUrl', 'clientId']
              : ['baseUrl', 'clientId', 'secret']
            ).includes(input);
          if (
            inputs[input] !== undefined ||
            (!requiredForFreshConnection &&
              !plan.report.findings.some(
                (f) =>
                  plan.report.resolved_scopes.includes(f.owner) &&
                  f.code === 'missing_required_key' &&
                  (f.key === key || f.key?.endsWith(`.${key}`)),
              ))
          )
            continue;
          try {
            const suggested =
              input === 'label'
                ? defaultLabel
                : input === 'baseUrl'
                  ? // Suggests keytec's own fleet instance so pressing Enter
                    // reaches a working setup with no site to look up first;
                    // it is a default, not a requirement — any base URL
                    // typed over it is used verbatim (BB-496).
                    'https://app.bakers.build'
                  : deviceCode && input === 'clientId'
                    ? 'bakers-cli'
                    : undefined;
            const answer =
              (await prompt(
                `${label}${suggested ? ` [${suggested}]` : ''}`,
                input === 'secret',
              )) || suggested;
            if (answer !== undefined) inputs[input] = answer;
          } catch {
            cancelled = true;
            break;
          }
          plan = planConfig(planning);
        }
      }
      let report = plan.report;
      if (cancelled) {
        report.findings.push({
          code: 'cancelled_selection',
          severity: 'error',
          stage: 'scope',
          path: cwd,
          key: null,
          expected: 'Explicit setup input is required.',
          observed: null,
          owner: 'project',
          related: [],
          statically_determined: false,
          remediation:
            'Rerun bakers config init with an explicit --scope and required input flags.',
          recheck: 'bakers config check --scope all',
        });
        report.result = 'blocked';
      }
      if (!cancelled && !options.dryRun && operation !== 'check') {
        report = applyConfigPlan(plan);
        if (!report.findings.some((f) => f.severity === 'error')) {
          const current = planConfig({
            ...planning,
            operation: 'check',
          }).report;
          report.files = current.files;
          report.findings = current.findings;
          report.result = current.result;
          report.verification = current.verification;
        }
      }
      if (!cancelled && operation === 'check')
        await checkAddonScopes(report, options.online === true, cwd);
      // A device-code connection authenticates from a session that sign-in
      // creates, and nothing has signed in yet when `init` has only just
      // written the file. Verifying here therefore reports
      // `authentication_failure` on a perfectly correct machine — a symptom
      // named in place of its cause, and the reason `bakers init` used to end
      // `failed` on every fresh setup. Writing the connection and signing in
      // are two steps, so `init` reports the second as outstanding instead.
      // An explicit `--online` still verifies, so the deferral is gated on
      // the whole predicate rather than on the file read alone — otherwise
      // `--auth-type device` defers the very check the operator asked for.
      // Read the grant off the connection that is about to be verified, not
      // off `--auth-type`: a repeat `bakers init` supplies no flag and writes
      // nothing, and keying on the input would leave exactly that run — the
      // one an operator uses as a diagnostic — reporting a failure again. A
      // read that fails falls through to the check, so a broken file is
      // reported rather than quietly skipped.
      let connectionGrant: unknown;
      if (operation === 'init' && planning.connectionPath)
        try {
          const fields = await reportLoadedBbConfigFields(
            planning.connectionPath,
          );
          // Locate the OAuth plugin by identity. Its grant is the only one
          // that says anything about signing in, and any plugin may carry a
          // `with.type` of its own, so matching on field shape alone reads
          // whichever happens to come first.
          const prefix = fields
            .find(
              (field) =>
                /^plugins\[\d+\]\.plugin$/.test(field.key) &&
                field.value === '@dropsh/plugin-oauth2',
            )
            ?.key.replace(/\.plugin$/, '');
          if (prefix !== undefined)
            connectionGrant = fields.find(
              (field) => field.key === `${prefix}.with.type`,
            )?.value;
        } catch {
          // Inventory findings already describe an unreadable or malformed file.
        }
      const awaitsSignIn =
        !options.online &&
        (inputs.authType === 'oauth2_device_code' ||
          connectionGrant === 'oauth2_device_code');
      if (
        !cancelled &&
        !options.dryRun &&
        !awaitsSignIn &&
        (operation === 'init' || options.online) &&
        !report.findings.some((f) => f.severity === 'error')
      ) {
        const { verifyConfigConnections } = await import('@bakers-build/core');
        report = await verifyConfigConnections(report, {
          cwd,
          host: deps.host ?? {
            resolveBases: [import.meta.url, pathToFileURL(`${cwd}/`).href],
          },
          ...(deps.stateDir ? { stateDir: deps.stateDir } : {}),
          // A fresh device-code connection cannot be verified without a
          // human confirming the code, so it is left to the ordinary
          // session-based check (which fails fast rather than polling
          // forever for a confirmation that never arrives).
          ...(freshConnection && inputs.authType !== 'oauth2_device_code'
            ? { ephemeralClientCredentials: true }
            : {}),
        });
      } else if (
        !options.dryRun &&
        (operation === 'init' || options.online) &&
        report.verification.online.status !== 'not_applicable'
      ) {
        // `bakers init` is also the diagnostic an operator re-runs on a finished
        // setup. Naming sign-in as the next step there is the one instruction
        // that is certainly wrong, so say which of the two situations this is.
        const { hasStoredBbSession } = await import('@bakers-build/core');
        const reason = awaitsSignIn
          ? (await hasStoredBbSession(
              deps.host ?? {
                resolveBases: [import.meta.url, pathToFileURL(`${cwd}/`).href],
              },
              {
                cwd,
                ...(planning.connectionPath
                  ? { explicit: planning.connectionPath }
                  : {}),
                ...(deps.stateDir ? { stateDir: deps.stateDir } : {}),
              },
            ))
            ? 'A session for this connection already exists; verify it with bakers config check --scope connection --online.'
            : 'Sign-in is the next step: run bakers auth login, then bakers config check --scope connection --online.'
          : 'Online validation skipped because offline errors require repair or input was cancelled.';
        report.verification.online.reason = reason;
        report.verification.skipped.push({
          path: report.roots.connection,
          stage: 'online',
          reason,
        });
      }
      const resolution =
        selectedConnection ??
        (planning.connectionPath
          ? {
              path: planning.connectionPath,
              connectionId: options.connection ?? 'default',
              selectionSource: options.connection
                ? 'flag-connection'
                : 'flag-config',
            }
          : undefined);
      if (resolution) {
        let fields: NonNullable<
          ConfigReport['connection_resolution']
        >['fields'] = [];
        try {
          fields = await reportLoadedBbConfigFields(resolution.path);
        } catch {
          // Inventory findings already describe an unreadable or malformed file.
        }
        report.connection_resolution = {
          id: resolution.connectionId ?? 'default',
          selected_by: resolution.selectionSource,
          path: resolution.path,
          fields,
        };
      }
      (deps.stdout ?? ((text) => process.stdout.write(text)))(
        options.format === 'json'
          ? `${JSON.stringify(report)}\n`
          : renderConfigReport(report, options.dryRun),
      );
      if (report.result !== 'ok') process.exitCode = 1;
    });
  }
}

export function registerConfig(
  program: Command,
  deps: ConfigCommandDeps = {},
): void {
  const group = program
    .command('config')
    .description(
      'initialize, migrate and validate scoped bakers.build configuration',
    );
  for (const operation of ['init', 'upgrade', 'check'] as ConfigOperation[])
    buildConfigCommand(group, operation, deps);

  // `bakers init` is the user-facing shortcut that sets up machine identity AND
  // the sign-in connection — the two things a human actually needs before
  // running anything else. There is no `--scope` for it at all: it silently
  // resolves both layers (via the same `all` inventory scope `bakers config
  // init --scope all` uses outside a project — config-inventory.ts — but
  // that value is never shown, defaulted, or documented here). The project
  // scope stays reachable only through the full `bakers config init --scope
  // project` command.
  buildConfigCommand(
    program,
    'init',
    deps,
    'all',
    'sign in: sets up machine identity and the connection (not project)',
  );
}
