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
  type AddonCapabilities,
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
} from './config-source-edit.js';
import {
  type ConnectionAuthType,
  DEFAULT_SLOT_ADDON,
  renderCommittedConfig,
  renderGlobalConnection,
  renderHostMachine,
} from './config-templates.js';
import { validateConfigSources } from './config-validation.js';

// The host reads this addon's capabilities before a fresh project file exists.
export { DEFAULT_SLOT_ADDON } from './config-templates.js';

export interface ConfigPlanOptions extends ConfigInventoryOptions {
  capabilities?: AddonCapabilities;
  slots?: Partial<Record<'server' | 'executor' | 'worktree', string>>;
  inputs?: {
    /** Machine display label; the machine UUID is always generated. */
    label?: string;
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
// Every config file is at schema v1; no migration step exists yet.
const CURRENT = {
  machine: 1,
  project: 1,
  connection: 1,
  'project-connection': 1,
};
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
  const capabilities = options.capabilities ?? {};
  const selectedSlots = Object.entries(options.slots ?? {});
  if (
    selectedSlots.length &&
    (options.operation !== 'init' ||
      !['project', 'all'].includes(options.scope ?? ''))
  )
    throw new Error('Slot flags require config init --scope project (or all).');
  for (const [slot, spec] of selectedSlots) {
    const capability = capabilities[spec];
    if (!capability)
      throw new Error(`--${slot}: cannot resolve addon '${spec}'.`);
    if (!capability.scopes.includes('project'))
      throw new Error(`--${slot}: '${spec}' does not allow project scope.`);
    if (!capability.slots.includes(slot))
      throw new Error(`--${slot}: '${spec}' contributes no ${slot}.`);
  }
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
  if (options.operation === 'check') {
    const validated = validateConfigSources(
      inventoryOptions,
      new Map(original),
      files,
      options.capabilities,
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
      // An old machine file is rewritten below, keeping its machine_id.
      (f.code === 'unsupported_schema_version' && f.path !== machine?.path) ||
      f.code === 'version_marker_disagreement',
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
          'unsupported_schema_version',
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
  if (!machine || !connection)
    return { report, writes: [], fingerprints: new Map() };
  if (machine.selected && !editors.has(machine.path))
    editors.set(
      machine.path,
      new ConfigSourceEditor(
        renderHostMachine({
          machineId: randomUUID(),
          ...(options.inputs?.label ? { label: options.inputs.label } : {}),
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
  }
  for (const file of files.filter(
    (candidate) => candidate.selected && candidate.kind === 'project',
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
    migrateCatalog(file, source);
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
        editor(file).remove('user_id');
        fill(file, 'machine_id', randomUUID());
        fill(file, 'label', options.inputs?.label);
        editor(file).stamp(1);
      }
      if (file.kind === 'project') {
        const fresh = !e || e.text.trim() === 'export default {};';
        if (fresh && file.required && options.project) {
          e = new ConfigSourceEditor(
            renderCommittedConfig({
              project: options.project,
              ...(options.inputs?.hooks ? { hooks: options.inputs.hooks } : {}),
              ...(options.inputs?.workspace
                ? { bakersWorkspace: options.inputs.workspace }
                : {}),
            }),
          );
          if (selectedSlots.length) {
            const contributed = new Set(
              selectedSlots.flatMap(
                ([, spec]) => capabilities[spec]?.slots ?? [],
              ),
            );
            if (options.slots?.executor) {
              const entries = Array.from(
                { length: e.property('addons')?.arrayLength ?? 0 },
                (_, index) => `addons[${index}]`,
              );
              e.set(
                'addons',
                `[${entries
                  .filter(
                    (key) =>
                      (e?.property(`${key}.use`)?.value ??
                        e?.property(key)?.value) !== DEFAULT_SLOT_ADDON,
                  )
                  .map((key) => e?.expression(key))
                  .join(', ')}]`,
              );
            }
            for (const slot of contributed) e.remove(slot);
          }
          editors.set(file.path, e);
        }
        if (!e) continue;
        {
          e = editor(file);
          fill(file, 'project.name', options.project);
          const addonPackages = new Set(
            [...e.source.properties]
              .filter(([key]) => /^addons\[\d+\](?:\.use)?$/.test(key))
              .map(([, property]) => property.value)
              .filter((value): value is string => typeof value === 'string'),
          );
          const existingPackages = [...addonPackages];
          for (const [slot, spec] of selectedSlots) {
            if (
              e.property(slot) ||
              existingPackages.some((pkg) =>
                capabilities[pkg]?.slots.includes(slot),
              )
            )
              continue;
            const addons = e.property('addons');
            if (addons && addons.nodeType !== 'ArrayExpression') {
              problem(
                file,
                'unsupported_source_shape',
                'addons',
                'A literal addons array is required to add a slot provider.',
              );
              continue;
            }
            if (!addonPackages.has(spec)) {
              const expression = e.expression('addons') ?? '[]';
              const before = expression.slice(0, -1).trimEnd();
              e.set(
                'addons',
                `${before}${before.endsWith('[') || before.endsWith(',') ? '' : ','} { use: ${JSON.stringify(spec)} }]`,
              );
              addonPackages.add(spec);
            }
          }
          const supplied = (slot: string) =>
            e?.property(slot) ||
            [...addonPackages].some(
              (pkg) =>
                capabilities[pkg]?.slots.includes(slot) ??
                pkg === DEFAULT_SLOT_ADDON,
            );
          if (options.slots?.executor && !supplied('worktree'))
            problem(
              file,
              'missing_required_key',
              'worktree',
              'The selected executor supplies no worktree; pass --worktree <package>.',
            );
          // The server comes from the connection; herdr fills a missing executor or worktree.
          for (const slot of ['executor', 'worktree']) {
            if (supplied(slot)) continue;
            if (slot === 'worktree' && options.slots?.executor) continue;
            const expression = e.expression('addons') ?? '[]';
            const before = expression.slice(0, -1).trimEnd();
            e.set(
              'addons',
              `${before}${before.endsWith('[') || before.endsWith(',') ? '' : ','} '${DEFAULT_SLOT_ADDON}']`,
            );
            addonPackages.add(DEFAULT_SLOT_ADDON);
          }
          if (
            options.operation === 'init' &&
            options.inputs?.workspace &&
            !e.property('project.workspace')
          )
            e.set(
              'project.workspace',
              JSON.stringify(options.inputs.workspace),
            );
          e.stamp(1);
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
      const version = file.version.effective ?? 1;
      if (version < BB_CONFIG_SCHEMA_VERSION)
        e.text = applyMigrations(e.text, version, BB_CONFIG_SCHEMA_VERSION);
      e.stamp(BB_CONFIG_SCHEMA_VERSION);
    } catch {
      problem(
        file,
        'unsupported_source_shape',
        null,
        'The supported connection migration chain completes safely.',
      );
    }
  }
  const overlay = new Map<string, string | null>(
    [...editors].map(([path, e]) => [path, e.text]),
  );
  for (const [path] of original)
    if (!editors.has(path)) overlay.set(path, null);
  const proposed = validateConfigSources(
    inventoryOptions,
    overlay,
    files,
    options.capabilities,
  );
  report.findings = [
    ...errors,
    ...proposed.findings.filter(
      (f) =>
        !errors.some(
          (e) => e.path === f.path && e.code === f.code && e.key === f.key,
        ),
    ),
  ];
  if (proposed.slot_sources) report.slot_sources = proposed.slot_sources;
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
          : file.kind === 'project'
            ? 0o644
            : 0o600,
    });
    report.changes.push({
      path: file.path,
      layer: file.layer,
      before_version: file.version.effective,
      after_version: after === null ? null : CURRENT[file.kind],
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

function oauthPrefix(e: ConfigSourceEditor): string | undefined {
  return [...e.source.properties]
    .find(
      ([key, p]) =>
        /^plugins\[\d+\]\.plugin$/.test(key) &&
        p.value === '@dropsh/plugin-oauth2',
    )?.[0]
    .replace(/\.plugin$/, '');
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
