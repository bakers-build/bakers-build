import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import {
  type ConfigFileReport,
  type ConfigFinding,
  type ConfigFindingCode,
  type ConfigInventoryOptions,
  type ConfigReport,
  configRecheckCommand,
  finalizeConfigReport,
  inspectConfigSource,
  inventoryConfig,
  shellQuote,
} from '@bakers-build/core';
import { applyMigrations, BB_CONFIG_SCHEMA_VERSION } from './config-schema.js';
import {
  ConfigSourceEditor,
  redactConfigSource,
  sameValue,
} from './config-source-edit.js';
import {
  type ConnectionAuthType,
  configImportExpression,
  DEFAULT_CONDUCTOR_AGENT_ADDONS,
  renderCommittedConfig,
  renderGlobalConnection,
  renderHostMachine,
} from './config-templates.js';
import {
  CONDUCTOR_ADDON_SLOTS,
  validateConfigSources,
} from './config-validation.js';
import { migrateAddonNames } from './migrate-addon-names.js';

export interface ConfigPlanOptions extends ConfigInventoryOptions {
  inputs?: {
    machineId?: string;
    userId?: string;
    maxParallel?: number;
    baseUrl?: string;
    clientId?: string;
    secret?: string;
    workspaceId?: string;
    workspace?: string;
    authType?: ConnectionAuthType;
    /** The operator's own answer for each lifecycle hook; bakers-cli names no provisioning tool. */
    hooks?: { after_create?: string; after_done?: string };
  };
}
export interface ConfigWrite {
  path: string;
  before: string | null;
  after: string | null;
  mode: number;
}
/** Only report is safe to serialize. Writes contain private source text. */
export interface ConfigPlan {
  report: ConfigReport;
  writes: ConfigWrite[];
  fingerprints: Map<string, string | null>;
}
const CURRENT = {
  machine: 3,
  // v1 is the first versioned conductor shape: the conductor owns only
  // remote/executor/workspace and declares no agent addons. Zero was the
  // implicit pre-versioned state (no @bakers-schema-version marker present).
  conductor: 1,
  connection: 4,
  'project-connection': 4,
};
const CONNECTION_KEYS = [
  'base_url',
  'client_id',
  'client_secret',
  'workspace_id',
] as const;
function fingerprint(text: string) {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}
function readFingerprint(path: string) {
  try {
    return fingerprint(readFileSync(path, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Inventory, transform in memory, validate the complete proposed installation. */
export function planConfig(options: ConfigPlanOptions = {}): ConfigPlan {
  // `conductor` is a bakers.build-specific sub-scope of `project`: it selects the same
  // files but communicates to the planner that only conductor-config changes are
  // requested. We map it to `project` for the inventory, which uses a strict
  // union type, and track the original scope so conductor-specific migrations
  // (agent-addon removal) are always applied when the requested scope is either
  // `conductor` or `all`.
  const requestedScope = options.scope;
  // Map the bakers.build-specific `conductor` sub-scope to `project` for the inventory,
  // which uses a strict ConfigScope union type that does not include `conductor`.
  // Use a spread to avoid passing an explicit `undefined` value (exactOptionalPropertyTypes).
  const inventoryScopeOverride =
    requestedScope === 'conductor'
      ? ({ scope: 'project' } as const)
      : requestedScope !== undefined
        ? { scope: requestedScope }
        : {};
  const inventoryOptions = {
    ...options,
    ...inventoryScopeOverride,
    operation: options.operation ?? 'upgrade',
    currentVersions: CURRENT,
  };
  const inventory = inventoryConfig(inventoryOptions);
  const report = inventory.report;
  const original = new Map(
    [...inventory.sources].map(([path, source]) => [path, source.text]),
  );
  const editors = new Map(
    [...original].map(([path, text]) => [path, new ConfigSourceEditor(text)]),
  );
  const files = report.files;
  const machine = files.find((f) => f.kind === 'machine');
  const connection = files.find((f) => f.kind === 'connection');
  const local = files.find((f) => f.kind === 'local');
  if (options.operation === 'check') {
    const validated = validateConfigSources(
      inventoryOptions,
      new Map(original),
      files,
    );
    return {
      report: finalizeConfigReport(validated),
      writes: [],
      fingerprints: new Map(files.map((f) => [f.path, f.fingerprint])),
    };
  }
  const errors: ConfigFinding[] = report.findings.filter(
    (f) =>
      (['scope', 'syntax', 'inventory'].includes(f.stage) &&
        f.code !== 'missing_required_file') ||
      ['future_schema_version', 'version_marker_disagreement'].includes(f.code),
  );
  const recheck =
    configRecheckCommand(
      (options.scope ?? 'all') as 'all',
      report.roots.project,
    ) +
    (options.machinePath
      ? ` --machine-path ${shellQuote(options.machinePath)}`
      : '') +
    (options.connectionPath
      ? ` --config ${shellQuote(options.connectionPath)}`
      : '');
  const problem = (
    file: ConfigFileReport,
    code: ConfigFindingCode,
    key: string | null,
    expected: string,
    related: ConfigFinding['related'] = [],
  ) => {
    const p = key ? editors.get(file.path)?.property(key) : undefined;
    errors.push({
      code,
      severity: 'error',
      stage: 'planning',
      path: file.path,
      key,
      expected,
      observed:
        p?.staticallyDetermined && !/secret|client_id|url/i.test(key ?? '')
          ? (p.value ?? null)
          : '[REDACTED]',
      owner: file.layer,
      related,
      statically_determined: p?.staticallyDetermined ?? false,
      remediation:
        code === 'out_of_scope_write_required'
          ? 'bakers config upgrade --scope all'
          : `Resolve ${key ?? 'configuration'} in ${shellQuote(file.path)}, then run ${recheck}.`,
      recheck,
      ...(p ? { line: p.line, column: p.column } : {}),
    });
  };
  const protectedFile = (file: ConfigFileReport) =>
    errors.some(
      (e) =>
        e.path === file.path &&
        [
          'future_schema_version',
          'version_marker_disagreement',
          'syntax_error',
          'unreadable_file',
        ].includes(e.code),
    );
  const editor = (file: ConfigFileReport) => {
    let e = editors.get(file.path);
    if (!e) {
      e = new ConfigSourceEditor('export default {};\n');
      editors.set(file.path, e);
    }
    return e;
  };
  const fill = (file: ConfigFileReport, key: string, value: unknown) => {
    const e = editor(file);
    const p = e.property(key);
    if (
      value !== undefined &&
      (!p || (p.staticallyDetermined && (p.value === '' || p.value === null)))
    )
      e.set(key, JSON.stringify(value));
  };
  const move = (
    from: ConfigFileReport,
    key: string,
    to: ConfigFileReport,
    target: string,
  ) => {
    const source = editors.get(from.path);
    const p = source?.property(key);
    if (!p || !source) return;
    if (!from.selected && !to.selected) return;
    if (!from.selected || !to.selected) {
      problem(
        from,
        'out_of_scope_write_required',
        key,
        'Both source and destination are selected writable layers.',
        [{ path: to.path, key: target }],
      );
      return;
    }
    if (protectedFile(from) || protectedFile(to)) return;
    const dest = editor(to);
    const existing = dest.property(target);
    if (!p.staticallyDetermined || p.value === undefined) {
      problem(
        from,
        'unknown_value',
        key,
        'The moved value must be a known literal.',
        [{ path: to.path, key: target }],
      );
      return;
    }
    if (existing && !sameValue(p, existing)) {
      problem(
        from,
        'conflicting_values',
        key,
        'Source and destination values agree.',
        [
          {
            path: to.path,
            key: target,
            line: existing.line,
            column: existing.column,
          },
        ],
      );
      return;
    }
    if (!existing) dest.set(target, source.expression(key) as string);
    source.remove(key);
  };
  if (!machine || !connection)
    return { report, writes: [], fingerprints: new Map() };
  if (
    machine.selected &&
    !editors.has(machine.path) &&
    options.inputs?.machineId &&
    options.inputs?.userId
  )
    editors.set(
      machine.path,
      new ConfigSourceEditor(
        renderHostMachine({
          machineId: options.inputs.machineId,
          userId: options.inputs.userId,
          maxParallel: options.inputs.maxParallel ?? 1,
        }),
      ),
    );
  const authType: ConnectionAuthType =
    options.inputs?.authType ?? 'oauth2_client_credentials';
  if (
    connection.selected &&
    !editors.has(connection.path) &&
    options.inputs?.baseUrl &&
    options.inputs?.clientId &&
    (authType === 'oauth2_device_code' || options.inputs?.secret)
  )
    editors.set(
      connection.path,
      new ConfigSourceEditor(
        renderGlobalConnection({
          baseUrl: options.inputs.baseUrl,
          clientId: options.inputs.clientId,
          ...(options.inputs.secret !== undefined
            ? { secret: options.inputs.secret }
            : {}),
          ...(options.inputs.workspaceId
            ? { workspaceId: options.inputs.workspaceId }
            : {}),
          authType,
        }),
      ),
    );

  const machineEditor = editor(machine);
  const literalSubtreeIssue = (
    source: ConfigSourceEditor,
    key: string,
  ): string | undefined => {
    const expression = source.expression(key);
    if (expression === undefined) return key;
    const inspected = inspectConfigSource(
      `export default { value: ${expression} };`,
    );
    if (inspected.syntax !== 'valid' || inspected.shape !== 'object')
      return key;
    const computed = inspected.propertyOccurrences.find(
      (property) =>
        (property.key === 'value' ||
          property.key.startsWith('value.') ||
          property.key.startsWith('value[')) &&
        !property.staticallyDetermined,
    );
    if (computed) return `${key}${computed.key.slice('value'.length)}`;
    return inspected.unknownKeys ? key : undefined;
  };
  const setMachineAgentValue = (
    sourceFile: ConfigFileReport,
    source: ConfigSourceEditor,
    sourceKey: string,
    targetKey: string,
    expression: string,
  ) => {
    const property = source.property(sourceKey);
    if (!property) return false;
    const issue = literalSubtreeIssue(source, sourceKey);
    if (!property.staticallyDetermined || issue) {
      problem(
        sourceFile,
        'unknown_value',
        issue ?? sourceKey,
        'The retired agent policy must be a statically known literal.',
        [{ path: machine.path, key: targetKey }],
      );
      return false;
    }
    const existing = machineEditor.expression(targetKey);
    if (existing !== undefined && existing !== expression) {
      problem(
        sourceFile,
        'conflicting_values',
        sourceKey,
        'The retired and nested machine agent policies agree.',
        [{ path: machine.path, key: targetKey }],
      );
      return false;
    }
    if (existing === undefined) machineEditor.set(targetKey, expression);
    source.remove(sourceKey);
    return true;
  };
  const legacyRoutesExpression = (
    sourceFile: ConfigFileReport,
    source: ConfigSourceEditor,
    key: string,
  ): string | undefined => {
    const routes = source.property(key);
    if (!routes) return undefined;
    if (routes.nodeType !== 'ObjectExpression') {
      problem(
        sourceFile,
        'unknown_value',
        key,
        'The retired route policy must be a statically known object.',
        [{ path: machine.path, key: 'agents.routes' }],
      );
      return undefined;
    }
    const subtreeIssue = literalSubtreeIssue(source, key);
    if (subtreeIssue) {
      problem(
        sourceFile,
        'unknown_value',
        subtreeIssue,
        'Every retired route must be a statically known state-to-alias map.',
        [{ path: machine.path, key: 'agents.routes' }],
      );
      return undefined;
    }
    const direct = [...source.source.properties]
      .filter(([name]) => {
        if (!name.startsWith(`${key}.`)) return false;
        return !name.slice(key.length + 1).includes('.');
      })
      .map(
        ([name, property]) => [name.slice(key.length + 1), property] as const,
      );
    const reject = (member: string) => {
      problem(
        sourceFile,
        'unknown_value',
        `${key}.${member}`,
        'Every retired route must be a statically known state-to-alias map.',
        [{ path: machine.path, key: `agents.routes.${member}` }],
      );
    };
    const validRoute = (name: string) => {
      const routeKey = `${key}.${name}`;
      const route = source.property(routeKey);
      if (
        !route?.staticallyDetermined ||
        route.nodeType !== 'ObjectExpression'
      ) {
        reject(name);
        return false;
      }
      const states = [...source.source.properties].filter(([member]) => {
        if (!member.startsWith(`${routeKey}.`)) return false;
        return !member.slice(routeKey.length + 1).includes('.');
      });
      const invalid = states.find(
        ([, property]) =>
          !property.staticallyDetermined || typeof property.value !== 'string',
      );
      if (states.length === 0 || invalid) {
        reject(invalid?.[0].slice(key.length + 1) ?? name);
        return false;
      }
      return true;
    };
    for (const [name, property] of direct) {
      if (name === 'default' && property.nodeType !== 'ObjectExpression') {
        if (
          !property.staticallyDetermined ||
          typeof property.value !== 'string'
        ) {
          reject(name);
          return undefined;
        }
        if (!direct.some(([routeName]) => routeName === property.value)) {
          reject(name);
          return undefined;
        }
        continue;
      }
      if (!validRoute(name)) return undefined;
    }
    const named = direct.filter(
      ([name, property]) =>
        name !== 'default' && property.nodeType === 'ObjectExpression',
    );
    const oldDefault = direct.find(([name]) => name === 'default')?.[1];
    let defaultExpression: string | undefined;
    if (oldDefault?.nodeType === 'ObjectExpression')
      defaultExpression = source.expression(`${key}.default`);
    else if (
      oldDefault?.staticallyDetermined &&
      typeof oldDefault.value === 'string'
    )
      defaultExpression = source.expression(`${key}.${oldDefault.value}`);
    const entries = [
      ...(defaultExpression ? [`default: ${defaultExpression}`] : []),
      ...named.map(
        ([name]) =>
          `${JSON.stringify(name)}: ${source.expression(`${key}.${name}`)}`,
      ),
    ];
    return `{ ${entries.join(', ')} }`;
  };
  const migrateStateDefaults = (
    sourceFile: ConfigFileReport,
    source: ConfigSourceEditor,
  ) => {
    const defaults = source.property('default_agent');
    if (!defaults) return;
    const expression = source.expression('default_agent');
    const subtreeIssue = literalSubtreeIssue(source, 'default_agent');
    if (
      !defaults.staticallyDetermined ||
      defaults.nodeType !== 'ObjectExpression' ||
      expression === undefined ||
      subtreeIssue
    ) {
      problem(
        sourceFile,
        'unknown_value',
        subtreeIssue ?? 'default_agent',
        'The retired state default must be a statically known object.',
        [{ path: machine.path, key: 'agents.routes.default' }],
      );
      return;
    }
    const currentRoute = machineEditor.expression('agents.routes.default');
    if (currentRoute !== undefined && currentRoute !== expression) {
      problem(
        sourceFile,
        'conflicting_values',
        'default_agent',
        'The retired state default and reserved default route agree.',
        [{ path: machine.path, key: 'agents.routes.default' }],
      );
      return;
    }
    if (currentRoute === undefined)
      machineEditor.set('agents.routes.default', expression);
    const catchAll = source.property('default_agent.*');
    if (
      catchAll?.staticallyDetermined &&
      typeof catchAll.value === 'string' &&
      !machineEditor.property('agents.default_agent')
    )
      machineEditor.set('agents.default_agent', JSON.stringify(catchAll.value));
    source.remove('default_agent');
  };
  const migrateCatalog = (
    sourceFile: ConfigFileReport,
    source: ConfigSourceEditor,
  ) => {
    const agent = source.property('agent');
    if (!agent) return;
    if (
      !agent.staticallyDetermined ||
      !['ArrayExpression', 'ObjectExpression'].includes(agent.nodeType)
    ) {
      problem(
        sourceFile,
        'unknown_value',
        'agent',
        'The retired agent descriptors must be statically known.',
        [{ path: machine.path, key: 'agents.catalog' }],
      );
      return;
    }
    const prefixes =
      agent.nodeType === 'ArrayExpression'
        ? Array.from(
            { length: agent.arrayLength ?? 0 },
            (_, index) => `agent[${index}]`,
          )
        : ['agent'];
    const catalog: string[] = [];
    const addonPackages: string[] = [];
    const unsupportedDirectMember = (
      prefix: string,
      allowed: ReadonlySet<string>,
    ) =>
      [...source.source.properties.keys()].find((key) => {
        if (!key.startsWith(`${prefix}.`)) return false;
        const member = key.slice(prefix.length + 1);
        return (
          !member.includes('.') && !member.includes('[') && !allowed.has(member)
        );
      });
    for (const prefix of prefixes) {
      const wrapped = Boolean(source.property(`${prefix}.agent`));
      const descriptor = wrapped ? `${prefix}.agent` : prefix;
      const unsupported = wrapped
        ? (unsupportedDirectMember(prefix, new Set(['agent', 'alias'])) ??
          unsupportedDirectMember(descriptor, new Set(['plugin', 'with'])))
        : unsupportedDirectMember(
            descriptor,
            new Set(['plugin', 'with', 'alias']),
          );
      if (unsupported) {
        problem(
          sourceFile,
          'unknown_value',
          unsupported,
          'Legacy candidate metadata without a lossless machine-catalog destination must be resolved manually.',
          [{ path: machine.path, key: 'agents.catalog' }],
        );
        return;
      }
      const harness = source.property(`${descriptor}.plugin`);
      if (!harness?.staticallyDetermined || typeof harness.value !== 'string') {
        problem(
          sourceFile,
          'unknown_value',
          'agent',
          'Every retired agent descriptor names a literal addon package.',
          [{ path: machine.path, key: 'agents.catalog' }],
        );
        return;
      }
      addonPackages.push(harness.value);
      const alias = source.property(`${prefix}.alias`);
      if (
        alias &&
        (!alias.staticallyDetermined || typeof alias.value !== 'string')
      ) {
        problem(
          sourceFile,
          'unknown_value',
          `${prefix}.alias`,
          'A migrated custom agent alias is a literal string.',
          [{ path: machine.path, key: 'agents.catalog' }],
        );
        return;
      }
      const withKey = `${descriptor}.with`;
      const withProperty = source.property(withKey);
      const withExpression = source.expression(withKey);
      if (withProperty) {
        const computedKey = literalSubtreeIssue(source, withKey);
        if (computedKey || withExpression === undefined) {
          problem(
            sourceFile,
            'unknown_value',
            computedKey ?? withKey,
            'Custom agent options must be statically known literals.',
            [{ path: machine.path, key: 'agents.catalog' }],
          );
          return;
        }
      }
      if (alias || withProperty)
        catalog.push(
          `{ harness: ${JSON.stringify(harness.value)}${alias ? `, alias: ${JSON.stringify(alias.value)}` : ''}${withProperty ? `, with: ${withExpression}` : ''} }`,
        );
    }
    if (catalog.length) {
      const expression = `[${catalog.join(', ')}]`;
      const existing = machineEditor.expression('agents.catalog');
      if (existing !== undefined && existing !== expression) {
        problem(
          sourceFile,
          'conflicting_values',
          'agent',
          'Retired custom variants agree with agents.catalog.',
          [{ path: machine.path, key: 'agents.catalog' }],
        );
        return;
      }
      if (existing === undefined)
        machineEditor.set('agents.catalog', expression);
    }
    const addon = source.property('addons');
    const uniquePackages = [...new Set(addonPackages)];
    if (!addon)
      source.set(
        'addons',
        `[${uniquePackages
          .map((use) => `{ use: ${JSON.stringify(use)} }`)
          .join(', ')}]`,
      );
    else {
      if (!addon.staticallyDetermined || addon.nodeType !== 'ArrayExpression') {
        problem(
          sourceFile,
          'unknown_value',
          'addons',
          'Agent harnesses can only be merged into a literal addons array.',
          [{ path: sourceFile.path, key: 'addons' }],
        );
        return;
      }
      const entries = Array.from(
        { length: addon.arrayLength ?? 0 },
        (_, index) => `addons[${index}]`,
      );
      const installed = new Set<string>();
      const authored: string[] = [];
      for (const entryKey of entries) {
        const entry = source.property(entryKey);
        const expression = source.expression(entryKey);
        if (!entry || expression === undefined) {
          problem(
            sourceFile,
            'unknown_value',
            entryKey,
            'Every existing addon entry must have a statically known package.',
            [{ path: sourceFile.path, key: 'addons' }],
          );
          return;
        }
        authored.push(expression);
        if (entry.staticallyDetermined && typeof entry.value === 'string') {
          installed.add(entry.value);
          continue;
        }
        if (entry.nodeType !== 'ObjectExpression') {
          problem(
            sourceFile,
            'unknown_value',
            entryKey,
            'Every existing addon entry must have a statically known package.',
            [{ path: sourceFile.path, key: 'addons' }],
          );
          return;
        }
        const packageProperty =
          source.property(`${entryKey}.use`) ??
          source.property(`${entryKey}.name`);
        if (
          !packageProperty?.staticallyDetermined ||
          typeof packageProperty.value !== 'string'
        ) {
          problem(
            sourceFile,
            'unknown_value',
            entryKey,
            'Every existing addon entry must have a statically known package.',
            [{ path: sourceFile.path, key: 'addons' }],
          );
          return;
        }
        installed.add(packageProperty.value);
      }
      const missing = uniquePackages.filter((use) => !installed.has(use));
      if (missing.length > 0)
        source.set(
          'addons',
          `[${[
            ...authored,
            ...missing.map((use) => `{ use: ${JSON.stringify(use)} }`),
          ].join(', ')}]`,
        );
    }
    source.remove('agent');
  };
  const deriveMachineDefault = () => {
    if (machineEditor.property('agents.default_agent')) return;
    const catchAll = machineEditor.property('agents.routes.default.*');
    if (catchAll?.staticallyDetermined && typeof catchAll.value === 'string')
      machineEditor.set('agents.default_agent', JSON.stringify(catchAll.value));
  };

  if (machine.selected && !protectedFile(machine)) {
    const oldAgents = machineEditor.property('agents');
    if (oldAgents?.nodeType === 'ArrayExpression') {
      const expression = machineEditor.expression('agents');
      const issue = literalSubtreeIssue(machineEditor, 'agents');
      if (issue) {
        problem(
          machine,
          'unknown_value',
          issue,
          'The retired agent policy must be a statically known literal.',
          [{ path: machine.path, key: 'agents.enabled' }],
        );
      } else if (expression !== undefined) {
        machineEditor.remove('agents');
        machineEditor.set('agents.enabled', expression);
      }
    }
    for (const [sourceKey, targetKey] of [
      ['enabled_agents', 'agents.enabled'],
      ['disabled_agents', 'agents.disabled'],
    ] as const) {
      const expression = machineEditor.expression(sourceKey);
      if (expression !== undefined)
        setMachineAgentValue(
          machine,
          machineEditor,
          sourceKey,
          targetKey,
          expression,
        );
    }
    const routes = legacyRoutesExpression(
      machine,
      machineEditor,
      'agent_routes',
    );
    if (routes !== undefined)
      setMachineAgentValue(
        machine,
        machineEditor,
        'agent_routes',
        'agents.routes',
        routes,
      );
    migrateStateDefaults(machine, machineEditor);
    deriveMachineDefault();
  }
  for (const file of files.filter(
    (candidate) =>
      candidate.selected && ['conductor', 'local'].includes(candidate.kind),
  )) {
    const source = editors.get(file.path);
    if (!source || protectedFile(file)) continue;
    const available = source.expression('agents');
    if (available !== undefined)
      setMachineAgentValue(file, source, 'agents', 'agents.enabled', available);
    const disabled = source.expression('disabled_agents');
    if (disabled !== undefined)
      setMachineAgentValue(
        file,
        source,
        'disabled_agents',
        'agents.disabled',
        disabled,
      );
    const routes = legacyRoutesExpression(file, source, 'agent_routes');
    if (routes !== undefined)
      setMachineAgentValue(
        file,
        source,
        'agent_routes',
        'agents.routes',
        routes,
      );
    migrateStateDefaults(file, source);
    if (file.kind === 'conductor') migrateCatalog(file, source);
    deriveMachineDefault();
  }
  if (
    editors.has(connection.path) &&
    connection.selected &&
    !protectedFile(connection) &&
    !protectedFile(machine)
  )
    replaceGeneratedMachineWiring(
      editor(connection),
      editor(machine),
      connection,
      options.inputs,
      problem,
    );
  // Machine connection values must move atomically with their connection destinations.
  for (const key of CONNECTION_KEYS) {
    const target =
      key === 'base_url'
        ? 'site.base_url'
        : key === 'workspace_id'
          ? key
          : `plugins[0].with.${key}`;
    const e = editors.get(machine.path);
    if (!e?.property(key)) continue;
    if (!machine.selected || !connection.selected) {
      problem(
        machine,
        'out_of_scope_write_required',
        key,
        'Machine and connection scopes are both required.',
        [{ path: connection.path, key: target }],
      );
      continue;
    }
    if (protectedFile(machine) || protectedFile(connection)) continue;
    const conn = editor(connection);
    // Generated v1-v3 wiring is resolved only from the recognized machine literal.

    if (key === 'client_id' || key === 'client_secret') {
      let prefix = oauthPrefix(conn);
      if (!prefix) {
        if (!conn.property('plugins'))
          conn.set(
            'plugins',
            "[{ plugin: '@bakers-build/addon-essentials' }, { plugin: '@dropsh/plugin-oauth2', export: 'oauth2Plugin', with: { id: 'bakers', default: true, type: 'oauth2_client_credentials', scope: 'bb:session' } }]",
          );
        prefix = oauthPrefix(conn);
      }
      if (!prefix) {
        problem(
          connection,
          'unsupported_source_shape',
          'plugins',
          'A statically known OAuth provider accepts migrated credentials.',
        );
        continue;
      }
      move(machine, key, connection, `${prefix}.with.${key}`);
    } else move(machine, key, connection, target);
  }
  for (const file of files) {
    if (protectedFile(file) || !file.selected) continue;
    let e = editors.get(file.path);
    if (e && e.source.shape !== 'object') {
      problem(
        file,
        'unsupported_source_shape',
        null,
        'A supported object source is required for migration.',
      );
      continue;
    }
    try {
      if (file.kind === 'machine') {
        fill(file, 'machine_id', options.inputs?.machineId);
        fill(file, 'user_id', options.inputs?.userId);
        fill(file, 'max_parallel', options.inputs?.maxParallel);
        e = editors.get(file.path);
        // Addon settings live only in the top-level addons[]: move the retired
        // `agents.addons` and `ports` keys there first.
        // Entries moved from agents.addons are the operator's harnesses; an
        // empty list names none, so it seeds like a missing one.
        const agentAddons = e?.property('agents.addons');
        const hadAgentAddons = !!agentAddons && agentAddons.arrayLength !== 0;
        if (e) migrateMachineAddons(e);
        // Machine 2 → 3: seed agent harnesses into addons[] when the machine
        // lists no harness (isHarness). Source: harness packages found in the
        // project conductor.config.js addons[], or a known default set when no
        // conductor config is available.
        const machineAddons = e?.property('addons');
        if (
          e &&
          !hadAgentAddons &&
          (!machineAddons || machineAddons.nodeType === 'ArrayExpression') &&
          arrayEntries(e, 'addons').every(
            (x) => typeof x.pkg === 'string' && !isHarness(x.pkg),
          )
        ) {
          const conductorFile = files.find((f) => f.kind === 'conductor');
          const conductorEditor = conductorFile
            ? editors.get(conductorFile.path)
            : undefined;
          let agentAddonsExpression: string | undefined;
          if (conductorEditor) {
            const agentEntries = [...conductorEditor.source.properties]
              .filter(([key]) => /^addons\[\d+\](?:\.use)?$/.test(key))
              .map(([, property]) => property.value)
              .filter(
                (value): value is string =>
                  typeof value === 'string' && isHarness(value),
              );
            if (agentEntries.length > 0)
              agentAddonsExpression = `[${agentEntries.map((pkg) => `{ use: ${JSON.stringify(pkg)} }`).join(', ')}]`;
          }
          if (!agentAddonsExpression) {
            // No conductor config or no agent entries found — seed a known default
            // set and surface a warning so the operator can review it.
            agentAddonsExpression = `['@bakers-build/addon-claude', '@bakers-build/addon-codex', '@bakers-build/addon-grok']`;
            report.findings.push({
              code: 'missing_required_file',
              severity: 'warning',
              stage: 'planning',
              path: file.path,
              key: 'addons',
              expected:
                'addons seeded with a default set of agent harnesses; review it and adjust to match your installed agent packages.',
              observed: null,
              owner: file.layer,
              related: [],
              statically_determined: true,
              remediation: `Edit ${file.path} to set addons to the packages you want, then run ${recheck}.`,
              recheck,
            });
          }
          const listed = arrayEntries(e, 'addons').map((x) => x.text);
          e.set(
            'addons',
            listed.length
              ? `[${[...listed, agentAddonsExpression.slice(1, -1)].join(', ')}]`
              : agentAddonsExpression,
          );
        }
        if (e) e.stamp(3);
      }
      if (file.kind === 'conductor' || file.kind === 'local') {
        if (
          (!e || e.text.trim() === 'export default {};') &&
          file.required &&
          options.project
        ) {
          e = new ConfigSourceEditor(
            renderCommittedConfig({
              project: options.project,
              ...(options.inputs?.hooks ? { hooks: options.inputs.hooks } : {}),
              ...(options.inputs?.workspace
                ? { bakersWorkspace: options.inputs.workspace }
                : {}),
            }),
          );
          editors.set(file.path, e);
        }
        if (!e) continue;
        if (file.kind === 'conductor') {
          e = editor(file);
          const legacyProject = e.property('project');
          const legacyWorkspace = e.property('bb_workspace');
          const nestedBb = e.property('bakers');
          const nestedExpression = e.expression('bakers');
          const nestedHasSpread = nestedExpression
            ? new ConfigSourceEditor(`export default ${nestedExpression};`)
                .source.unknownKeys
            : false;
          let projectExpression = e.expression('project');
          if (
            projectExpression === 'project' &&
            /const project\s*=\s*local\.project\s*\?\?\s*([^;]+);/.test(e.text)
          ) {
            const fallback =
              /const project\s*=\s*local\.project\s*\?\?\s*([^;]+);/
                .exec(e.text)?.[1]
                ?.trim();
            const literal = fallback
              ? new ConfigSourceEditor(
                  `export default { value: ${fallback} };`,
                ).property('value')
              : undefined;
            if (
              literal?.staticallyDetermined &&
              typeof literal.value === 'string'
            ) {
              projectExpression = fallback;
              e.text = e.text.replace(
                /const project\s*=\s*local\.project\s*\?\?\s*[^;]+;/,
                `const project = ${fallback};`,
              );
            }
          }
          const staticProject = projectExpression
            ? new ConfigSourceEditor(
                `export default { value: ${projectExpression} };`,
              ).property('value')
            : undefined;
          if (
            nestedBb &&
            (nestedBb.nodeType !== 'ObjectExpression' ||
              !nestedBb.staticallyDetermined ||
              nestedHasSpread)
          )
            problem(
              file,
              'unsupported_source_shape',
              'bakers',
              'A literal bakers object is required.',
            );
          else if (
            legacyProject &&
            (!staticProject?.staticallyDetermined ||
              typeof staticProject.value !== 'string')
          )
            problem(
              file,
              'unknown_value',
              'project',
              'A literal project name is required for migration.',
            );
          else if (
            legacyWorkspace &&
            (!legacyWorkspace.staticallyDetermined ||
              typeof legacyWorkspace.value !== 'string')
          )
            problem(
              file,
              'unknown_value',
              'bb_workspace',
              'A literal workspace name is required for migration.',
            );
          else if (legacyProject || legacyWorkspace) {
            const existingProject = e.property('bakers.project');
            const existingWorkspace = e.property('bakers.workspace');
            if (
              legacyProject &&
              existingProject &&
              (!existingProject.staticallyDetermined ||
                existingProject.value !== staticProject?.value)
            )
              problem(
                file,
                'conflicting_values',
                'project',
                'Legacy and nested project names must agree.',
              );
            else if (
              legacyWorkspace &&
              existingWorkspace &&
              (!existingWorkspace.staticallyDetermined ||
                existingWorkspace.value !== legacyWorkspace.value)
            )
              problem(
                file,
                'conflicting_values',
                'bb_workspace',
                'Legacy and nested workspace names must agree.',
              );
            else {
              if (legacyProject && !existingProject)
                e.set('bakers.project', projectExpression as string);
              if (legacyWorkspace && !existingWorkspace)
                e.set(
                  'bakers.workspace',
                  e.expression('bb_workspace') as string,
                );
              e.remove('project');
              e.remove('bb_workspace');
            }
          }
          fill(file, 'bakers.project', options.project);
          const canonical = new ConfigSourceEditor(
            renderCommittedConfig({
              project: options.project ?? 'project',
            }),
          );
          const addonPackages = new Set(
            [...e.source.properties]
              .filter(([key]) => /^addons\[\d+\](?:\.use)?$/.test(key))
              .map(([, property]) => property.value)
              .filter((value): value is string => typeof value === 'string'),
          );
          const providers: Record<string, string[]> = {
            remote: [
              '@bakers-build/addon-remote-drupal',
              '@bakers-build/addon-fake',
            ],
            executor: ['@bakers-build/addon-herdr', '@bakers-build/addon-fake'],
            workspace: [
              '@bakers-build/addon-herdr',
              '@bakers-build/addon-fake',
              '@bakers-build/addon-workspace-git',
            ],
          };
          for (const slot of ['remote', 'executor', 'workspace']) {
            if (
              e.property(slot) ||
              providers[slot]?.some((provider) => addonPackages.has(provider))
            )
              continue;
            e.set(slot, canonical.expression(slot) as string);
          }
          // Only seed default agent addons into an unversioned conductor config.
          // A versioned config (schema v1+) has already been migrated: agents
          // belong to machine.config.js and the conductor addons[] must not be
          // repopulated with the old agent harnesses on re-run.
          if (
            !e.property('agent') &&
            !e.property('addons') &&
            !(file.version.effective ?? 0)
          )
            e.set('addons', DEFAULT_CONDUCTOR_AGENT_ADDONS);
          if (
            options.operation === 'init' &&
            options.inputs?.workspace &&
            !e.property('bakers.workspace')
          )
            e.set('bakers.workspace', JSON.stringify(options.inputs.workspace));
          if (!e.property('conductor_id') && !e.property('machine_id')) {
            const machineEditor = editors.get(machine.path);
            const machineId = machineEditor?.property('machine_id');
            const userId = machineEditor?.property('user_id');
            const project = e.property('bakers.project');
            if (
              typeof machineId?.value === 'string' &&
              typeof userId?.value === 'string' &&
              typeof project?.value === 'string'
            )
              e.set(
                'conductor_id',
                JSON.stringify(
                  `${userId.value}-${machineId.value}-${project.value}`,
                ),
              );
          }
        }
        for (const key of ['max_parallel', 'conductor.max_parallel'])
          move(file, key, machine, 'max_parallel');
        const old = e.property('machine_id');
        const current = e.property('conductor_id');
        if (old) {
          if (
            current &&
            !sameValue(old, current) &&
            e.expression('machine_id') !== e.expression('conductor_id')
          )
            problem(
              file,
              'conflicting_values',
              'machine_id',
              'The deprecated and current conductor identity must agree.',
              [
                {
                  path: file.path,
                  key: 'conductor_id',
                  line: current.line,
                  column: current.column,
                },
              ],
            );
          else if (current) e.remove('machine_id');
          else e.rename('machine_id', 'conductor_id');
        }
        if (
          file.kind === 'conductor' &&
          e.text.includes('async function loadMachine()')
        )
          // The committed conductor config never names this machine's path
          // (AC 4): the replacement is the same portable BB_HOME/HOME
          // expression init renders, not a serialised file:// URL. The match
          // is widened past a single backtick pair so it also catches the
          // nested-backtick form the current template emits.
          e.text = e.text.replace(
            /import\(`(?:[^`\\]|\\.|`[^`]*`)*\/(?:machine\.config\.js|conductor\.config\.machine\.js)`\)/g,
            `import(${configImportExpression('machine.config.js')})`,
          );
        e.text = migrateAddonNames(e.text, 'engine').text;
        if (file.kind === 'conductor') {
          // Conductor 0 → 1: remove agent-addon entries from addons[], leaving
          // only remote/executor/workspace provider packages (and any spread
          // expressions such as `...(local.agent_addons ?? [])`). If addons[]
          // becomes empty, remove the key. Idempotent: a file already at v1
          // (effective version set) is left entirely unchanged on re-run.
          // Agent packages are those NOT in the canonical non-agent provider set
          // (same definition as the conductor slot-filling heuristic).
          if (!(file.version.effective ?? 0)) {
            const NON_AGENT_PACKAGES = new Set([
              '@bakers-build/addon-remote-drupal',
              '@bakers-build/addon-herdr',
              '@bakers-build/addon-fake',
              '@bakers-build/addon-workspace-git',
            ]);
            const addonsProperty = e.property('addons');
            if (
              addonsProperty?.staticallyDetermined &&
              addonsProperty.nodeType === 'ArrayExpression'
            ) {
              const length = addonsProperty.arrayLength ?? 0;
              const kept: string[] = [];
              for (let i = 0; i < length; i++) {
                const entryKey = `addons[${i}]`;
                const entry = e.property(entryKey);
                // Keep non-statically-known entries (e.g. spread) and entries
                // whose package is a known non-agent provider.
                const useProperty =
                  e.property(`${entryKey}.use`) ??
                  e.property(`${entryKey}.name`);
                const pkg =
                  entry?.staticallyDetermined && typeof entry.value === 'string'
                    ? entry.value
                    : useProperty?.staticallyDetermined &&
                        typeof useProperty.value === 'string'
                      ? useProperty.value
                      : undefined;
                if (pkg === undefined || NON_AGENT_PACKAGES.has(pkg)) {
                  const expr = e.expression(entryKey);
                  if (expr !== undefined) kept.push(expr);
                }
              }
              if (kept.length === 0) e.remove('addons');
              else if (kept.length < length)
                e.set('addons', `[${kept.join(', ')}]`);
            }
            // Stamp v1 so subsequent runs skip this block (idempotent).
            e.stamp(1);
          }
        }
      }
    } catch {
      problem(
        file,
        'unsupported_source_shape',
        null,
        'The required source spans can be safely rewritten.',
      );
    }
  }
  // Connection files share one real schema chain. Missing fields use explicit inputs only.
  for (const file of files.filter(
    (f) => f.selected && f.kind === 'connection',
  )) {
    if (protectedFile(file)) continue;
    let e = editors.get(file.path);
    // An absent connection is rendered wholesale above once the grant's full
    // precondition is met; without it, per-field filling would write an
    // incomplete file (BB-496).
    if (!e && file.kind === 'connection') continue;
    if (!e && !file.required) continue;
    if (!e) e = editor(file);
    if (e.source.shape !== 'object') {
      problem(
        file,
        'unsupported_source_shape',
        null,
        'A supported connection object can be migrated.',
      );
      continue;
    }
    try {
      if (file.kind === 'connection') {
        fill(file, 'site.base_url', options.inputs?.baseUrl);
        fill(file, 'workspace_id', options.inputs?.workspaceId);
        if (
          !e.property('plugins') &&
          (options.inputs?.clientId || options.inputs?.secret)
        )
          e.set(
            'plugins',
            "[{ plugin: '@bakers-build/addon-essentials' }, { plugin: '@dropsh/plugin-oauth2', export: 'oauth2Plugin', with: { id: 'bakers', default: true, type: 'oauth2_client_credentials', scope: 'bb:session' } }]",
          );
        const prefix = oauthPrefix(e);
        if (prefix) {
          fill(file, `${prefix}.with.client_id`, options.inputs?.clientId);
          fill(file, `${prefix}.with.client_secret`, options.inputs?.secret);
          const url = e.property('site.base_url')?.value;
          if (
            typeof url === 'string' &&
            !e.property(`${prefix}.with.token_url`)
          )
            e.set(
              `${prefix}.with.token_url`,
              JSON.stringify(`${url.replace(/\/$/, '')}/oauth/token`),
            );
        }
      }
      if (file.kind === 'project-connection') migrateGeneratedProject(e);
      const version = file.version.effective ?? 1;
      if (version < BB_CONFIG_SCHEMA_VERSION)
        e.text = applyMigrations(e.text, version, BB_CONFIG_SCHEMA_VERSION);
      e.text = migrateAddonNames(e.text, 'connection').text;
      if (file.kind === 'project-connection' && local) {
        const prefix = oauthPrefix(e);
        const secret = prefix
          ? e.property(`${prefix}.with.client_secret`)
          : undefined;
        if (secret?.staticallyDetermined && secret.value) {
          move(
            file,
            `${prefix}.with.client_secret`,
            local,
            'oauth.client_secret',
          );
          if (!e.property(`${prefix}.with.client_secret`)) {
            e.set(`${prefix}.with.client_secret`, 'local.oauth?.client_secret');
            if (!/const local\s*=|let local\s*=/.test(e.text))
              e.text =
                "let local = {};\ntry { local = (await import('./conductor.config.local.js')).default; } catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }\n" +
                e.text;
          }
        }
      }
      e.stamp(4);
    } catch {
      problem(
        file,
        'unsupported_source_shape',
        null,
        'The supported connection migration chain completes safely.',
      );
    }
  }
  if (
    machine.selected &&
    !protectedFile(machine) &&
    editors.has(machine.path) &&
    !editor(machine).property('max_parallel')
  )
    editor(machine).set('max_parallel', '1');
  const overlay = new Map<string, string | null>(
    [...editors].map(([path, e]) => [path, e.text]),
  );
  for (const [path] of original)
    if (!editors.has(path)) overlay.set(path, null);
  const proposed = validateConfigSources(inventoryOptions, overlay, files);
  report.findings = [
    ...errors,
    ...proposed.findings.filter(
      (f) =>
        !errors.some(
          (e) => e.path === f.path && e.code === f.code && e.key === f.key,
        ),
    ),
  ];
  report.verification.skipped = proposed.verification.skipped;
  const writes: ConfigWrite[] = [];
  for (const file of files.filter((f) => f.selected)) {
    const before = original.get(file.path) ?? null;
    const after = overlay.has(file.path)
      ? (overlay.get(file.path) ?? null)
      : before;
    if (before === after) continue;
    writes.push({
      path: file.path,
      before,
      after,
      mode:
        before !== null
          ? statSync(file.path).mode & 0o777
          : file.kind === 'project-connection' || file.kind === 'conductor'
            ? 0o644
            : 0o600,
    });
    report.changes.push({
      path: file.path,
      layer: file.layer,
      before_version: file.version.effective,
      after_version:
        after === null
          ? null
          : file.kind === 'machine'
            ? 3
            : ['connection', 'project-connection'].includes(file.kind)
              ? 4
              : file.kind === 'conductor'
                ? 1
                : null,
      diff: `--- ${file.path}\n+++ ${file.path}\n${
        before === null
          ? ''
          : redactConfigSource(before)
              .split('\n')
              .map((l) => `- ${l}`)
              .join('\n')
      }\n${
        after === null
          ? ''
          : redactConfigSource(after)
              .split('\n')
              .map((l) => `+ ${l}`)
              .join('\n')
      }`,
    });
  }
  const fingerprints = new Map(
    files.map((file) => [file.path, file.fingerprint]),
  );
  finalizeConfigReport(report);
  return { report, writes, fingerprints };
}

const PORTS_ADDON = '@bakers-build/addon-ports';
/** A package known to fill no agent slot is not a harness; an unknown one may be. */
function isHarness(pkg: string): boolean {
  return CONDUCTOR_ADDON_SLOTS[pkg]?.includes('agent') ?? true;
}

/**
 * Source text, package and alias of each element of the array at `key`; the
 * alias is '' when absent and undefined when not a literal.
 */
function arrayEntries(
  e: ConfigSourceEditor,
  key: string,
): Array<{ text: string; pkg: unknown; alias: unknown }> {
  const length = e.property(key)?.arrayLength ?? 0;
  return Array.from({ length }, (_, i) => {
    const item = `${key}[${i}]`;
    const alias = e.property(`${item}.alias`);
    return {
      text: e.expression(item) ?? '',
      pkg:
        e.property(item)?.value ??
        e.property(`${item}.use`)?.value ??
        e.property(`${item}.name`)?.value,
      alias: !alias ? '' : alias.staticallyDetermined ? alias.value : undefined,
    };
  });
}

/**
 * Move the retired machine keys into the top-level `addons[]`: each
 * `agents.addons` entry not already listed with the same text, and `ports`
 * as the `@bakers-build/addon-ports` entry's `with`. Only literal arrays/objects
 * move; an opaque value stays for `bakers config check` to report.
 */
function migrateMachineAddons(e: ConfigSourceEditor) {
  const addons = e.property('addons');
  if (addons && addons.nodeType !== 'ArrayExpression') return;
  // A spread has no element span to carry over; rebuilding would drop it.
  const opaque = (key: string) => arrayEntries(e, key).some((x) => !x.text);
  if (opaque('addons') || opaque('agents.addons')) return;
  const agentAddons = e.property('agents.addons');
  if (agentAddons?.nodeType === 'ArrayExpression') {
    const listed = arrayEntries(e, 'addons');
    const merged = [...listed];
    for (const x of arrayEntries(e, 'agents.addons')) {
      if (merged.some((y) => y.text === x.text)) continue;
      // Possibly the same package as a listed entry under a possibly equal
      // alias but other text: moving would drop or override settings, so leave
      // it for `bakers config check`. A variable package may be any harness; two
      // variables still move, as distinct entries. Entries of agents.addons
      // already stood together, so they are not compared with each other.
      const clash = listed.some(
        (y) =>
          (typeof x.pkg === 'string' && typeof y.pkg === 'string'
            ? x.pkg === y.pkg
            : typeof x.pkg === 'string'
              ? isHarness(x.pkg)
              : typeof y.pkg === 'string' && isHarness(y.pkg)) &&
          (x.alias === undefined ||
            y.alias === undefined ||
            x.alias === y.alias),
      );
      if (clash) return movePorts(e);
      merged.push(x);
    }
    e.set('addons', `[${merged.map((x) => x.text).join(', ')}]`);
    e.remove('agents.addons');
    const agents = e.property('agents');
    if (
      agents?.nodeType === 'ObjectExpression' &&
      ![...e.source.properties.keys()].some((k) => k.startsWith('agents.'))
    )
      e.remove('agents');
  }
  movePorts(e);
}

function movePorts(e: ConfigSourceEditor) {
  const ports = e.property('ports');
  if (ports?.nodeType !== 'ObjectExpression') return;
  const settings = e.expression('ports') as string;
  const listed = arrayEntries(e, 'addons');
  const at = listed.findIndex((x) => x.pkg === PORTS_ADDON);
  const entry = `{ use: '${PORTS_ADDON}', with: ${settings} }`;
  if (at < 0) {
    e.set('addons', `[${[...listed.map((x) => x.text), entry].join(', ')}]`);
  } else if (e.property(`addons[${at}]`)?.nodeType === 'Literal') {
    e.set(`addons[${at}]`, entry);
  } else if (!e.property(`addons[${at}].with`)) {
    e.set(`addons[${at}].with`, settings);
  } else return; // both set: leave `ports` for the check to report
  e.remove('ports');
}

function oauthPrefix(e: ConfigSourceEditor): string | undefined {
  return [...e.source.properties]
    .find(
      ([key, p]) =>
        /^plugins\[\d+\]\.plugin$/.test(key) &&
        p.value === '@dropsh/plugin-oauth2',
    )?.[0]
    .replace(/\.plugin$/, '');
}
function replaceGeneratedMachineWiring(
  e: ConfigSourceEditor,
  machine: ConfigSourceEditor,
  file: ConfigFileReport,
  inputs: ConfigPlanOptions['inputs'],
  problem: (
    file: ConfigFileReport,
    code: ConfigFindingCode,
    key: string | null,
    expected: string,
  ) => void,
) {
  if (!e.text.includes('async function loadMachine()')) return;
  const mappings: Record<string, string> = {
    baseUrl: 'base_url',
    clientId: 'client_id',
    clientSecret: 'client_secret',
    workspaceId: 'workspace_id',
  };
  const resolved = new Map<string, string>();
  for (const [name, key] of Object.entries(mappings)) {
    const declaration = new RegExp(`const ${name} = ([^;]+);`).exec(e.text);
    if (!declaration) continue;
    const literal = new ConfigSourceEditor(
      `export default {value:${declaration[1]}};`,
    ).property('value');
    if (literal?.staticallyDetermined && literal.value !== undefined)
      resolved.set(name, JSON.stringify(literal.value));
    else if (
      new RegExp(
        `^(?:local\\.[^;]+\\?\\? )?machine\\.${key}(?: \\?\\? 'bakers-agent')?$`,
      ).test(declaration[1] ?? '')
    ) {
      // The retired home-local sibling is absent (inventory refuses otherwise),
      // so a generated `local.x ??` prefix evaluates to the machine value.
      const p = machine.property(key);
      const input = key === 'workspace_id' ? inputs?.workspaceId : undefined;
      const value =
        p?.staticallyDetermined && p.value != null
          ? p.value
          : (input ?? (key === 'client_id' ? 'bakers-agent' : undefined));
      if (value !== undefined) resolved.set(name, JSON.stringify(value));
    }
  }
  for (const key of [...e.source.properties.keys()]) {
    const expr = e.expression(key);
    const value = expr ? resolved.get(expr) : undefined;
    if (value !== undefined) e.set(key, value);
  }
  for (const [name, value] of resolved)
    e.text = e.text.replace(
      new RegExp(`const ${name} = [^;]+;`),
      `const ${name} = ${value};`,
    );
  if (
    [...e.source.properties.keys()].some((key) =>
      Object.hasOwn(mappings, e.expression(key) ?? ''),
    )
  ) {
    problem(
      file,
      'unknown_value',
      null,
      'Generated connection values require known inputs before removing machine ownership.',
    );
    return;
  }
  if (
    [...e.source.properties.keys()].some((key) =>
      /\bmachine\./.test(e.expression(key) ?? ''),
    )
  )
    return;
  e.text = e.text
    .replace(/async function loadMachine\(\) \{[\s\S]*?\n\}\n/, '')
    .replace(/const machine = await loadMachine\(\);\n?/, '');
}
function migrateGeneratedProject(e: ConfigSourceEditor) {
  if (!e.text.includes('async function loadMachine()')) return;
  if (
    [...e.source.properties.keys()].some((key) =>
      /\bmachine\./.test(e.expression(key) ?? ''),
    )
  )
    return;
  if (!e.property('workspace_id'))
    e.set('workspace_id', 'local.workspace_id ?? connection.workspace_id');
  // Both imports land in a COMMITTED file, so neither may carry this machine's
  // path — the connection import leaks ~/.bakers just as the machine one does.
  e.text = e.text
    .replace(
      /async function loadMachine\(\) \{[\s\S]*?\n\}\n/,
      `async function loadConnection() { return (await import(${configImportExpression('bakers.config.js')})).default; }\n`,
    )
    .replace(
      'const machine = await loadMachine();',
      "const connection = await loadConnection();\nconst auth = connection.plugins.find(entry => entry.plugin === '@dropsh/plugin-oauth2')?.with;",
    )
    .replace(/machine\.base_url/g, 'connection.site.base_url')
    .replace(/machine\.client_id(?: \?\? 'bakers-agent')?/g, 'auth?.client_id')
    .replace(/machine\.client_secret/g, 'auth?.client_secret')
    .replace(/machine\.workspace_id/g, 'connection.workspace_id');
  if (/\bmachine\.(?:user_id|machine_id)/.test(e.text))
    e.text =
      `const machine = (await import(${configImportExpression('machine.config.js')})).default;\n` +
      e.text;
}
/** Fingerprints are checked for the whole inventory before creating any backup. */
/**
 * Best-effort pretty-print of a written `.js` config through biome. The planner
 * builds config text with surgical `ConfigSourceEditor` inserts (to preserve
 * operator edits, comments and exact values), which can leave a freshly inserted
 * line mis-indented; a format pass normalizes the whole file. Explicit options
 * (space/2/single) make the result deterministic regardless of any biome.json
 * discovered near the target — a user's `~/.bakers/` has none, and biome's built-in
 * defaults (tabs, double quotes) would clash with the bakers.build config style.
 *
 * NEVER fails the upgrade: biome is a dev/monorepo dependency, absent on a global
 * install. If it cannot be resolved or errors, the (already-correct) file stands.
 */
function formatConfigFileBestEffort(path: string): void {
  if (!path.endsWith('.js')) return;
  try {
    const require = createRequire(import.meta.url);
    const biomeBin = require.resolve('@biomejs/biome/bin/biome');
    execFileSync(
      process.execPath,
      [
        biomeBin,
        'format',
        '--write',
        '--indent-style=space',
        '--indent-width=2',
        '--javascript-formatter-quote-style=single',
        path,
      ],
      { stdio: 'ignore' },
    );
  } catch {
    // biome unavailable or non-zero exit — leave the surgically-edited file as is.
  }
}

export function applyConfigPlan(plan: ConfigPlan): ConfigReport {
  const report = plan.report;
  if (report.findings.some((f) => f.severity === 'error')) return report;
  const add = (
    code: ConfigFindingCode,
    path: string,
    expected: string,
    remediation: string,
  ) => {
    const file = report.files.find((f) => f.path === path);
    report.findings.push({
      code,
      severity: 'error',
      stage: 'write',
      path,
      key: null,
      expected,
      observed: null,
      owner: file?.layer ?? 'project',
      related: [],
      statically_determined: true,
      remediation,
      recheck: configRecheckCommand(
        (report.requested_scope ?? 'all') as 'all',
        report.roots.project,
      ),
    });
  };
  for (const [path, expected] of plan.fingerprints) {
    try {
      if (readFingerprint(path) !== expected)
        add(
          'changed_since_planning',
          path,
          'Source is unchanged since planning.',
          'Re-run bakers config upgrade with the selected scope.',
        );
    } catch {
      add(
        'changed_since_planning',
        path,
        'Source remains readable.',
        'Restore access and re-run the planner.',
      );
    }
  }
  if (report.findings.some((f) => f.severity === 'error'))
    return finalizeConfigReport(report);
  const applied: ConfigWrite[] = [];
  const temps: string[] = [];
  try {
    for (const write of plan.writes) {
      mkdirSync(dirname(write.path), { recursive: true, mode: 0o700 });
      if (write.before !== null) {
        let backup = `${write.path}.bakers.bak`;
        while (existsSync(backup))
          backup = `${write.path}.${randomUUID()}.bakers.bak`;
        writeFileSync(backup, write.before, { mode: 0o600, flag: 'wx' });
      }
      if (write.after === null) {
        rmSync(write.path);
        applied.push(write);
        continue;
      }
      const temp = `${write.path}.${randomUUID()}.tmp`;
      temps.push(temp);
      writeFileSync(temp, write.after, { mode: write.mode, flag: 'wx' });
      renameSync(temp, write.path);
      applied.push(write);
      // Pretty-print the surgically-edited file (best-effort), then re-assert mode.
      formatConfigFileBestEffort(write.path);
      chmodSync(write.path, write.mode);
    }
  } catch {
    const remaining: string[] = [];
    for (const write of applied.reverse()) {
      try {
        if (write.before === null) rmSync(write.path, { force: true });
        else {
          const temp = `${write.path}.${randomUUID()}.restore`;
          temps.push(temp);
          writeFileSync(temp, write.before, { mode: 0o600, flag: 'wx' });
          renameSync(temp, write.path);
        }
      } catch {
        remaining.push(write.path);
      }
    }
    for (const temp of temps)
      try {
        rmSync(temp, { force: true });
      } catch {
        /* The failure report names the affected target. */
      }
    add(
      'write_failure',
      remaining[0] ?? plan.writes[applied.length]?.path ?? report.roots.machine,
      'All planned writes complete.',
      remaining.length
        ? `Restore remaining changed files from private backups: ${remaining.join(', ')}.`
        : 'Caught write failure; changed configuration files were restored. Recheck permissions and retry.',
    );
  }
  return finalizeConfigReport(report);
}
