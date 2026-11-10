import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { shellQuote } from '../core/shell.js';
import {
  findConfigProjectBbDir,
  homeBbDir,
  stemForConfigFile,
} from './bakers-dir.js';
import {
  type ConfigFileKind,
  type ConfigFileReport,
  type ConfigFinding,
  type ConfigFindingCode,
  type ConfigLayer,
  type ConfigOperation,
  type ConfigReport,
  type ConfigScope,
  configRecheckCommand,
  finalizeConfigReport,
} from './config-report.js';
import {
  type ConfigSourceInspection,
  type ConfigSourceProperty,
  inspectConfigSource,
} from './config-source.js';
import { type ConfigKind, checkConfigText } from './config-validate.js';

const SCHEMA_KIND: Record<ConfigFileKind, ConfigKind> = {
  machine: 'machine',
  connection: 'connection',
  'project-connection': 'connection',
  project: 'project',
};

export interface ConfigInventoryOptions {
  operation?: ConfigOperation;
  scope?: string;
  cwd?: string;
  path?: string;
  home?: string;
  machinePath?: string;
  connectionPath?: string;
  project?: string;
  /**
   * The `bakers init` shortcut's own scope resolution: `all` without ever
   * pulling the project layer in, even when a project root resolves. Never
   * set by `bakers config init --scope all`, which keeps today's behaviour of
   * including a resolved project root (BB-496 finding 1).
   */
  excludeProjectLayer?: boolean;
  /** Schema policy is supplied by the owning command/migration registry. */
  currentVersions?: Partial<Record<ConfigFileKind, number>>;
  /** Internal planner overlay: proposed modules are validated without filesystem writes. */
  sourceTexts?: ReadonlyMap<string, string | null>;
  /** Where addon packages resolve from (the CLI install), after the config's dir and cwd. */
  addonBases?: string[];
}

export interface ConfigInventory {
  report: ConfigReport;
  /** Secret-bearing data for the planner, never part of the public report. */
  sources: Map<string, ConfigSourceInspection>;
}

const SCOPES: ConfigScope[] = ['machine', 'connection', 'project', 'all'];
const SECRET_KEY = /secret|token|password|credential|client_id|authorization/i;

/** Public observed values never include expressions, objects or credentials. */
function observed(
  property: ConfigSourceProperty | undefined,
  key: string,
): string | number | boolean | null {
  if (SECRET_KEY.test(key)) return '[REDACTED]';
  if (!property) return null;
  if (!property.staticallyDetermined) return '[COMPUTED]';
  // URL userinfo/query may contain credentials; expose only shape on errors.
  if (/url/i.test(key)) return '[URL REDACTED]';
  return property.value ?? `[${property.nodeType}]`;
}

/** Collect selected files and prerequisite sources without importing any module. */
export function inventoryConfig(
  options: ConfigInventoryOptions = {},
): ConfigInventory {
  const operation = options.operation ?? 'check';
  // The `.bakers` root is core's decision (BAKERS_HOME), not this function's; an
  // explicit options.home still pins it, which is what fixtures rely on.
  const bakersRoot = homeBbDir(options.home);
  const cwd = resolve(options.cwd ?? process.cwd());
  const machinePath = resolve(
    options.machinePath ?? join(bakersRoot, 'machine.config.js'),
  );
  const connectionPath = resolve(
    options.connectionPath ?? join(bakersRoot, 'connections', 'default.js'),
  );
  const discovered = findConfigProjectBbDir(
    options.path ? resolve(cwd, options.path) : cwd,
    options.home,
  );
  const projectRoot = options.path
    ? resolve(cwd, options.path)
    : discovered
      ? dirname(discovered)
      : null;
  const scope = options.scope ?? 'all';
  const validScope = SCOPES.includes(scope as ConfigScope);
  const resolved: ConfigLayer[] = validScope
    ? scope === 'all'
      ? [
          'machine',
          'connection',
          ...(projectRoot && !options.excludeProjectLayer
            ? ['project' as const]
            : []),
        ]
      : [scope as ConfigLayer]
    : [];
  const report: ConfigReport = {
    report_version: 1,
    operation,
    requested_scope: options.scope ?? null,
    resolved_scopes: resolved,
    project: options.project ?? null,
    roots: {
      machine: dirname(machinePath),
      connection: dirname(connectionPath),
      project: projectRoot,
    },
    files: [],
    changes: [],
    findings: [],
    connection_resolution: null,
    result: 'ok',
    verification: {
      offline: { status: 'passed' },
      online:
        scope === 'machine'
          ? {
              status: 'not_applicable',
              reason: 'Machine scope has no connection validation.',
            }
          : {
              status: 'pending',
              reason:
                'Offline inspection does not authenticate or verify workspace access.',
            },
      readiness: scope === 'machine' ? 'not_applicable' : 'unverified',
      skipped: [],
    },
  };
  const sources = new Map<string, ConfigSourceInspection>();
  const recheck =
    configRecheckCommand(
      validScope ? (scope as ConfigScope) : 'all',
      projectRoot,
    ) +
    (options.machinePath ? ` --machine-path ${shellQuote(machinePath)}` : '') +
    (options.connectionPath ? ` --config ${shellQuote(connectionPath)}` : '');
  const scopeProblem = (
    code: ConfigFindingCode,
    expected: string,
    remediation: string,
  ) => {
    report.findings.push({
      code,
      severity: 'error',
      stage: 'scope',
      path: projectRoot ?? cwd,
      key: 'scope',
      expected,
      observed: options.scope ?? null,
      owner: 'project',
      related: [],
      statically_determined: true,
      remediation,
      recheck,
    });
  };
  if (!validScope)
    scopeProblem(
      'invalid_scope',
      'Scope is machine, connection, project or all.',
      'bakers config check --scope all',
    );
  else if (operation === 'init' && options.scope === undefined)
    scopeProblem(
      'scope_required',
      'Initialization requires an explicit scope.',
      'Choose bakers config init --scope machine; bakers config init --scope connection; bakers config init --scope project --project <name>; or bakers config init --scope all --project <name>.',
    );
  else if (
    (scope === 'project' && !projectRoot) ||
    (operation === 'init' && scope === 'project' && !options.project) ||
    // `all` only pulls in the project layer when a project root actually
    // resolves (mirroring the resolution above); outside a project it stays
    // machine + connection, and `bakers init` relies on exactly that to
    // initialize both without demanding an unrelated project name.
    // `excludeProjectLayer` (the `bakers init` shortcut) never pulls the
    // project layer in at all, so it never hits this gate either — it stays
    // machine + connection inside a project checkout too (BB-496 finding 1).
    (operation === 'init' &&
      scope === 'all' &&
      projectRoot &&
      !options.project &&
      !options.excludeProjectLayer)
  ) {
    scopeProblem(
      'project_required',
      'A resolved project root and explicit initialization project name are required.',
      'bakers config init --scope project --path <directory> --project <name>',
    );
  }
  if (report.findings.length)
    return { report: finalizeConfigReport(report), sources };
  if (!projectRoot && scope === 'all')
    report.verification.skipped.push({
      path: cwd,
      stage: 'project',
      reason: 'Project scope is not applicable outside a project.',
    });

  const inspectFile = (
    path: string,
    kind: ConfigFileKind,
    layer: ConfigLayer,
    required: boolean,
    role: 'primary' | 'supplementary' = 'primary',
  ) => {
    const selected = resolved.includes(layer);
    const file: ConfigFileReport = {
      path,
      kind,
      layer,
      role,
      selected,
      required,
      state: 'absent',
      fingerprint: null,
      version: {
        header: null,
        field: null,
        effective: null,
        current: options.currentVersions?.[kind] ?? null,
      },
    };
    report.files.push(file);
    const add = (
      code: ConfigFindingCode,
      key: string | null,
      expected: string,
      remediation: string,
      stage: ConfigFinding['stage'] = 'schema',
      severity: ConfigFinding['severity'] = 'error',
      property?: ConfigSourceProperty,
      owner: ConfigLayer = layer,
    ) => {
      if (!selected) return;
      report.findings.push({
        code,
        severity,
        stage,
        path,
        key,
        expected,
        observed: observed(property, key ?? ''),
        owner,
        related: [],
        statically_determined: property?.staticallyDetermined ?? key === null,
        remediation,
        recheck,
        ...(property ? { line: property.line, column: property.column } : {}),
      });
    };
    const setTunnelPolicy = (tunnel: boolean | null) => {
      if (kind !== 'machine' || !selected) return;
      report.machine_policy = { tunnel, source: path };
    };
    let text: string;
    try {
      if (options.sourceTexts?.has(path)) {
        const proposed = options.sourceTexts.get(path);
        if (proposed === null)
          throw Object.assign(new Error('Absent'), { code: 'ENOENT' });
        text = proposed as string;
      } else text = readFileSync(path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        if (required)
          add(
            'missing_required_file',
            null,
            'Required configuration file exists.',
            `bakers config init --scope ${layer}${layer === 'project' && projectRoot ? ` --path ${shellQuote(projectRoot)} --project ${options.project ? shellQuote(options.project) : '<name>'}` : ''}`,
            'inventory',
          );
        setTunnelPolicy(false);
      } else {
        file.state = 'unreadable';
        add(
          'unreadable_file',
          null,
          'Configuration is a readable regular file.',
          `Restore read access to ${shellQuote(path)}, then run ${recheck}.`,
          'inventory',
        );
        setTunnelPolicy(null);
      }
      return;
    }
    file.fingerprint = `sha256:${createHash('sha256').update(text).digest('hex')}`;
    const source = inspectConfigSource(text);
    sources.set(path, source);
    if (source.syntax === 'invalid') {
      file.state = 'malformed';
      add(
        'syntax_error',
        null,
        'Valid ECMAScript module syntax.',
        `Repair JavaScript syntax in ${shellQuote(path)}, then run ${recheck}.`,
        'syntax',
      );
      if (selected) {
        const finding = report.findings[report.findings.length - 1];
        if (finding) Object.assign(finding, source.syntaxError);
        report.verification.skipped.push({
          path,
          stage: 'schema',
          reason: 'Syntax validation failed.',
        });
      }
      setTunnelPolicy(null);
      return;
    }
    if (source.shape !== 'object') {
      file.state = 'unsupported';
      add(
        'unsupported_source_shape',
        null,
        'A directly exported object can be inspected offline.',
        `Expose a supported export default object in ${shellQuote(path)}, or validate this custom configuration online.`,
        'schema',
        'warning',
      );
      if (selected)
        report.verification.skipped.push({
          path,
          stage: 'schema',
          reason: 'Default export is not a statically inspectable object.',
        });
      setTunnelPolicy(null);
      return;
    }
    file.state = 'valid';
    // An explicit executor slot: the machine's wins over the project's.
    if (
      selected &&
      source.properties.get('executor') &&
      (kind === 'machine' ||
        (kind === 'project' && report.executor_source === undefined))
    )
      report.executor_source = path;
    const startFindings = report.findings.length;
    const field = source.properties.get('schema_version');
    file.version.header = source.headerVersions[0] ?? null;
    file.version.field =
      field?.staticallyDetermined && typeof field.value === 'number'
        ? field.value
        : null;
    const markers = [
      ...source.headerVersions,
      ...(file.version.field !== null ? [file.version.field] : []),
    ];
    const disagree = new Set(markers).size > 1;
    file.version.effective = disagree ? null : (markers[0] ?? null);
    if (disagree)
      add(
        'version_marker_disagreement',
        'schema_version',
        'Header and schema_version markers agree.',
        `Reconcile version markers in ${shellQuote(path)} with its actual schema before upgrading.`,
        'schema',
        'error',
        field,
      );
    const currentVersion = file.version.current;
    if (
      currentVersion !== null &&
      markers.some((version) => version !== currentVersion)
    ) {
      add(
        'unsupported_schema_version',
        'schema_version',
        `Schema version is ${currentVersion}.`,
        kind === 'machine'
          ? 'Run bakers init to rewrite it at version 1.'
          : `Remove ${shellQuote(path)} and run bakers init to recreate it.`,
        'schema',
        'error',
        field,
      );
    }
    const requireValue = (
      key: string,
      expected: string,
      valid: (property: ConfigSourceProperty) => boolean,
      requiredKey = true,
    ) => {
      const property = source.properties.get(key);
      const parentKey = key.includes('.')
        ? key.slice(0, key.lastIndexOf('.'))
        : null;
      const parent = parentKey ? source.properties.get(parentKey) : undefined;
      if (!property && !requiredKey) return;
      if (!property && parent && !parent.staticallyDetermined) {
        if (selected)
          report.verification.skipped.push({
            path,
            stage: `schema:${key}`,
            reason: `Parent ${parentKey} is computed.`,
          });
        return;
      }
      const unknown = property
        ? !property.staticallyDetermined
        : source.unknownKeys;
      if (unknown)
        add(
          'unknown_value',
          key,
          expected,
          `Determine ${key} in ${shellQuote(path)}; ${scope === 'machine' ? `set a literal value and run ${recheck}` : `run ${recheck} --online to validate computed values`}.`,
          'schema',
          'warning',
          property,
        );
      else if (!property)
        add(
          'missing_required_key',
          key,
          expected,
          `Set ${key} in ${shellQuote(path)}; expected ${expected}`,
          'schema',
        );
      else if (!valid(property))
        add(
          'invalid_value',
          key,
          expected,
          `Repair ${key} in ${shellQuote(path)}; expected ${expected}`,
          'schema',
          'error',
          property,
        );
    };
    const nonempty = (property: ConfigSourceProperty) =>
      typeof property.value === 'string' && property.value.trim() !== '';
    if (kind === 'machine') {
      const tunnel = source.properties.get('tunnel');
      const tunnelExpected = 'A boolean tunnel sharing policy.';
      if (tunnel) {
        setTunnelPolicy(
          tunnel.staticallyDetermined && typeof tunnel.value === 'boolean'
            ? tunnel.value
            : null,
        );
      } else if (source.unknownKeys) {
        add(
          'unknown_value',
          'tunnel',
          tunnelExpected,
          `Determine tunnel in ${shellQuote(path)}; set a literal value and run ${recheck}.`,
          'schema',
          'warning',
        );
        setTunnelPolicy(null);
      } else {
        setTunnelPolicy(false);
      }
      // Addon settings live only in the addon's `addons[]` entry: the retired
      // machine keys fail at load, so name the exact replacement here. A
      // fragment carrying a secret-shaped key is never echoed.
      const fragmentOf = (property: ConfigSourceProperty) => {
        const text = source.text.slice(property.valueStart, property.valueEnd);
        return SECRET_KEY.test(text)
          ? `<the value at line ${property.line}>`
          : text.replace(/\s+/g, ' ');
      };
      const agentAddons = source.properties.get('agents.addons');
      if (agentAddons) {
        const items = fragmentOf(agentAddons).replace(/^\[\s*|\s*\]$/g, '');
        add(
          'retired_key',
          'agents.addons',
          'Agent harnesses are listed in the top-level addons[].',
          `Move agents.addons into the top-level addons[] of ${shellQuote(path)}: addons: [${items}].`,
          'schema',
          'error',
          agentAddons,
        );
      }
      const ports = source.properties.get('ports');
      if (ports)
        add(
          'retired_key',
          'ports',
          'The ports transport is set in the @bakers-build/addon-ports addons[] entry.',
          `Move ports into the addons[] of ${shellQuote(path)}: addons: [{ use: '@bakers-build/addon-ports', with: ${fragmentOf(ports)} }].`,
          'schema',
          'error',
          ports,
        );
      for (const key of [
        'base_url',
        'client_id',
        'client_secret',
        'workspace_id',
      ]) {
        const property = source.properties.get(key);
        if (property)
          add(
            'misplaced_key',
            key,
            `Connection-owned ${key} belongs in ${connectionPath}.`,
            `Move ${key} from ${shellQuote(path)} into ${shellQuote(connectionPath)}.`,
            'ownership',
            'error',
            property,
            'connection',
          );
      }
    }
    if (kind === 'connection' || kind === 'project-connection') {
      // The schema checks the shape; an OAuth provider also needs credentials.
      const plugins = source.properties.get('plugins');
      if (plugins?.nodeType === 'ArrayExpression') {
        for (let index = 0; index < (plugins.arrayLength ?? 0); index++) {
          const entry = `plugins[${index}]`;
          const descriptor = source.properties.get(entry);
          if (descriptor?.nodeType === 'ObjectExpression') {
            if (
              source.properties.get(`${entry}.plugin`)?.value ===
              '@dropsh/plugin-oauth2'
            ) {
              // A public client (device-code grant) declares no
              // client_secret at all (BB-496). A descriptor whose type is
              // not statically determinable keeps the stricter pair
              // requirement.
              const publicClient =
                source.properties.get(`${entry}.with.type`)?.value ===
                'oauth2_device_code';
              for (const key of publicClient
                ? ['client_id']
                : ['client_id', 'client_secret'])
                requireValue(
                  `${entry}.with.${key}`,
                  'A nonempty OAuth credential.',
                  nonempty,
                );
            }
          }
        }
      }
    }
    if (kind !== 'machine') {
      const property = source.properties.get('tunnel');
      if (property)
        add(
          'misplaced_key',
          'tunnel',
          `Machine-owned tunnel belongs in ${machinePath}.`,
          `Move tunnel from ${shellQuote(path)} into ${shellQuote(machinePath)}.`,
          'ownership',
          'error',
          property,
          'machine',
        );
    }
    // Field checks: the same schema the loader applies, on the literal values.
    const reported = new Set(
      report.findings.slice(startFindings).map((finding) => finding.key),
    );
    for (const problem of checkConfigText(SCHEMA_KIND[kind], text, {
      bases: [
        pathToFileURL(`${dirname(path)}/`).href,
        pathToFileURL(`${cwd}/`).href,
        ...(options.addonBases ?? []),
        import.meta.url,
      ],
    })) {
      // Version markers are judged above against the command's current version.
      if (problem.key === 'schema_version' || reported.has(problem.key))
        continue;
      const key = problem.key || null;
      const at = key ? `${key} in ${shellQuote(path)}` : shellQuote(path);
      add(
        problem.code,
        key,
        key ? `${key}: ${problem.message}` : problem.message,
        problem.code === 'not_checked' || problem.code === 'options_not_checked'
          ? `Nothing to repair offline; the loader checks ${at} when the conductor starts.`
          : `Repair ${at}: ${problem.message.replace(/\.$/, '')}.`,
        'schema',
        problem.severity,
        key ? source.properties.get(key) : undefined,
      );
      if (problem.line !== undefined) {
        const finding = report.findings.at(-1);
        if (finding && finding.key === key)
          Object.assign(finding, {
            line: problem.line,
            column: problem.column,
          });
      }
    }
    const findings = report.findings.slice(startFindings);
    if (findings.some((finding) => finding.severity === 'error'))
      file.state = 'partial';
    else if (
      findings.some(
        (finding) =>
          finding.code === 'unknown_value' || finding.code === 'not_checked',
      )
    )
      file.state = 'computed';
  };

  inspectFile(machinePath, 'machine', 'machine', true);
  inspectFile(connectionPath, 'connection', 'connection', true);
  if (projectRoot) {
    const bakersDir = join(projectRoot, '.bakers');
    let names: string[] = [];
    try {
      names = readdirSync(bakersDir)
        .filter((name) => stemForConfigFile(name) !== undefined)
        .sort();
    } catch {
      /* Missing/partial roots still inventory their required default file. */
    }
    if (names.length === 0) names = ['project.config.js'];
    for (const name of names)
      inspectFile(join(bakersDir, name), 'project', 'project', true);
    inspectFile(
      join(bakersDir, 'connection.config.js'),
      'project-connection',
      'project',
      false,
    );
  }
  // Cross-file ownership diagnostics use the same inspected values as callers.
  // Equal duplicates still need relocation, but are not conflicts.
  for (const finding of [...report.findings]) {
    if (finding.code !== 'misplaced_key' || !finding.key) continue;
    const source = sources.get(finding.path)?.properties.get(finding.key);
    let destinationPath: string;
    let destinationKey: string;
    if (finding.related[0]?.key) {
      destinationPath = finding.related[0].path;
      destinationKey = finding.related[0].key;
    } else if (finding.owner === 'machine') {
      destinationPath = machinePath;
      destinationKey = finding.key;
    } else {
      destinationPath = connectionPath;
      destinationKey =
        finding.key === 'base_url' ? 'site.base_url' : finding.key;
      if (finding.key === 'client_id' || finding.key === 'client_secret') {
        const connection = sources.get(connectionPath);
        const auth = [...(connection?.properties.values() ?? [])].find(
          (property) =>
            /^plugins\[\d+\]\.plugin$/.test(property.key) &&
            property.value === '@dropsh/plugin-oauth2',
        );
        destinationKey = auth
          ? auth.key.replace(/\.plugin$/, `.with.${finding.key}`)
          : `plugins[oauth2].with.${finding.key}`;
      }
    }
    const destination = sources
      .get(destinationPath)
      ?.properties.get(destinationKey);
    const location = {
      path: destinationPath,
      key: destinationKey,
      ...(destination
        ? { line: destination.line, column: destination.column }
        : {}),
    };
    finding.related = [location];
    if (
      source?.staticallyDetermined &&
      destination?.staticallyDetermined &&
      source.value !== destination.value
    ) {
      report.findings.push({
        ...finding,
        code: 'conflicting_values',
        expected: 'Source and destination values agree before relocation.',
        remediation: `Choose the intended ${finding.key} value between ${shellQuote(finding.path)} and ${shellQuote(destinationPath)}, then keep it only in ${shellQuote(destinationPath)}.`,
      });
    }
    if (!resolved.includes(finding.owner)) {
      report.findings.push({
        ...finding,
        code: 'out_of_scope_write_required',
        expected: `Repair requires writing ${destinationPath}, outside selected scope ${scope}.`,
        remediation: `Move ${finding.key} into ${shellQuote(destinationPath)}.`,
      });
    }
  }
  return { report: finalizeConfigReport(report), sources };
}
