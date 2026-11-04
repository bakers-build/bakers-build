import {
  type ConfigFileReport,
  type ConfigFinding,
  type ConfigInventoryOptions,
  type ConfigReport,
  configRecheckCommand,
  inventoryConfig,
  shellQuote,
} from '@bakers-build/core';
import { ConfigSourceEditor } from './config-source-edit.js';

/**
 * Known addons and the CONDUCTOR slots each fills. An empty list means "known
 * addon, fills no conductor slot" — a UI-only addon (BB-562) belongs in a
 * conductor `addons[]` but contributes a cockpit tab, not a slot. Listing it is
 * not cosmetic: an UNKNOWN specifier sets `addonsAreOpaque` below, which
 * downgrades a genuinely missing remote/executor/workspace from
 * `missing_required_key` to `unknown_value`.
 */
export const CONDUCTOR_ADDON_SLOTS: Record<string, string[]> = {
  '@bakers-build/addon-remote-drupal': ['remote'],
  '@bakers-build/addon-herdr': ['executor', 'workspace'],
  '@bakers-build/addon-orca': ['executor', 'workspace'],
  '@bakers-build/addon-fake': ['remote', 'executor', 'workspace'],
  '@bakers-build/addon-workspace-git': ['workspace'],
  '@bakers-build/addon-claude': ['agent'],
  '@bakers-build/addon-codex': ['agent'],
  '@bakers-build/addon-grok': ['agent'],
  '@bakers-build/addon-kimi': ['agent'],
  '@bakers-build/addon-opencode': ['agent'],
  '@bakers-build/addon-pi': ['agent'],
  '@bakers-build/addon-ports': [],
  '@bakers-build/addon-ports-cloudflare': [],
  '@bakers-build/addon-ports-cloudflare-quick': [],
  '@bakers-build/addon-ports-frp': [],
  '@bakers-build/addon-bakers-ui': [],
  '@bakers-build/addon-bakers-ui-artifacts': [],
  '@bakers-build/addon-agents': [],
  '@bakers-build/addon-auth-basic': [],
  '@bakers-build/addon-ddev': [],
  '@bakers-build/addon-deployment': [],
  '@bakers-build/addon-docker-compose': [],
  '@bakers-build/addon-dropsh': [],
  '@bakers-build/addon-essentials': [],
  '@bakers-build/addon-info': [],
  '@bakers-build/addon-name-refs': [],
  '@bakers-build/addon-track': [],
  '@bakers-build/addon-workspace': [],
};

function validateConductorSources(
  options: ConfigInventoryOptions,
  editors: Map<string, ConfigSourceEditor>,
  report: ConfigReport,
) {
  const recheck = configRecheckCommand(
    (options.scope ?? 'all') as 'all',
    report.roots.project,
  );
  const localFile = report.files.find(
    (candidate) => candidate.kind === 'local',
  );
  const localEditor = localFile ? editors.get(localFile.path) : undefined;
  for (const file of report.files.filter(
    (candidate) => candidate.selected && candidate.kind === 'conductor',
  )) {
    const editor = editors.get(file.path);
    if (editor?.source.shape !== 'object') continue;
    const start = report.findings.length;
    const add = (
      code: ConfigFinding['code'],
      key: string,
      expected: string,
      property = editor.property(key),
      findingPath = file.path,
    ) => {
      const unknown = code === 'unknown_value';
      report.findings.push({
        code,
        severity: unknown ? 'warning' : 'error',
        stage: 'schema',
        path: findingPath,
        key,
        expected,
        observed: unknown ? '[COMPUTED]' : (property?.value ?? null),
        owner: 'project',
        related: [],
        statically_determined: property?.staticallyDetermined ?? false,
        remediation: `${unknown ? 'Determine' : 'Set'} ${key} in ${shellQuote(findingPath)}, then run ${recheck}.`,
        recheck,
        ...(property ? { line: property.line, column: property.column } : {}),
      });
    };
    for (const legacy of ['project', 'bb_workspace']) {
      if (!editor.property(legacy)) continue;
      add(
        'misplaced_key',
        legacy,
        `Committed bakers.build identity belongs under bakers.${legacy === 'project' ? 'project' : 'workspace'}.`,
      );
      const finding = report.findings.at(-1);
      if (finding)
        finding.remediation = `Move ${legacy} to bakers.${legacy === 'project' ? 'project' : 'workspace'} in ${shellQuote(file.path)}, then run ${recheck}.`;
    }
    // A conductor is machine + project + variant: no project file names an id.
    for (const [source, path] of [
      [editor, file.path],
      [localEditor, localFile?.path],
    ] as const) {
      if (!source || !path) continue;
      for (const key of ['conductor_id', 'machine_id', 'label']) {
        const property = source.property(key);
        if (!property) continue;
        add(
          'retired_key',
          key,
          'No identity in a project config: a conductor is machine + project + variant.',
          property,
          path,
        );
        const finding = report.findings.at(-1);
        if (finding)
          finding.remediation = `Remove ${key} from ${shellQuote(path)}; the machine identity comes from bakers init.`;
      }
    }
    const bakers = editor.property('bakers');
    const bakersExpression = editor.expression('bakers');
    if (
      bakers &&
      (bakers.nodeType !== 'ObjectExpression' ||
        (bakersExpression &&
          new ConfigSourceEditor(`export default ${bakersExpression};`).source
            .unknownKeys))
    ) {
      add(
        'unsupported_source_shape',
        'bakers',
        'A statically inspectable bakers object without spreads is required.',
      );
      const finding = report.findings.at(-1);
      if (finding)
        finding.remediation = `Write bakers as a literal object without spreads in ${shellQuote(file.path)}, then run ${recheck}.`;
    }
    const validateIdentity = (key: 'bakers.project') => {
      const property = editor.property(key);
      if (!property) {
        add(
          editor.source.unknownKeys ? 'unknown_value' : 'missing_required_key',
          key,
          'A nonempty conductor project.',
        );
      } else if (
        property.staticallyDetermined &&
        typeof property.value === 'string' &&
        property.value.trim() !== ''
      ) {
        return;
      } else {
        add(
          property.staticallyDetermined ? 'invalid_value' : 'unknown_value',
          key,
          'A nonempty conductor project.',
          property,
        );
      }
    };
    validateIdentity('bakers.project');

    const addon = editor.property('addons');
    const addonSlots = new Set<string>();
    let addonsAreOpaque = false;
    if (addon) {
      if (addon.nodeType !== 'ArrayExpression') addonsAreOpaque = true;
      else
        for (let index = 0; index < (addon.arrayLength ?? 0); index++) {
          const entry = `addons[${index}]`;
          const specifier =
            editor.property(entry)?.value ??
            editor.property(`${entry}.use`)?.value;
          if (typeof specifier !== 'string') addonsAreOpaque = true;
          else {
            const contributions = CONDUCTOR_ADDON_SLOTS[specifier];
            if (!contributions) addonsAreOpaque = true;
            else for (const slot of contributions) addonSlots.add(slot);
          }
        }
    }
    // The `agent` slot is intentionally excluded: agent ownership now belongs to
    // machine.config.js (machine schema v3+). A conductor config that declares
    // no agent slot or no agent-contributing addons is valid — machine.config.js
    // provides the candidates at runtime. Existing pre-migration configs that
    // still carry agent addons continue to validate until the conductor 0→1
    // migration removes them.
    for (const slot of ['remote', 'executor', 'workspace']) {
      const property = editor.property(slot);
      if (
        slot === 'workspace' &&
        property?.staticallyDetermined &&
        typeof property.value === 'string' &&
        property.value.trim() !== '' &&
        addonSlots.has('workspace')
      )
        continue;
      if (!property) {
        if (addonSlots.has(slot)) continue;
        add(
          addon && addonsAreOpaque ? 'unknown_value' : 'missing_required_key',
          slot,
          `A conductor ${slot} plugin supplied by an explicit slot or known addon.`,
        );
        continue;
      }
      if (!property.staticallyDetermined) {
        add(
          'unknown_value',
          slot,
          `A conductor ${slot} plugin supplied by an explicit slot or known addon.`,
          property,
        );
        continue;
      }
      const descriptor = (prefix: string, kind: string) => {
        const plugin = editor.property(`${prefix}.plugin`)?.value;
        return (
          (typeof plugin === 'string' && plugin.trim() !== '') ||
          editor.property(`${prefix}.kind`)?.value === kind
        );
      };
      if (slot === 'agent' && property.nodeType === 'ArrayExpression') {
        let unknownCandidate = false;
        let invalidCandidate = (property.arrayLength ?? 0) === 0;
        for (let index = 0; index < (property.arrayLength ?? 0); index++) {
          const prefix = `agent[${index}]`;
          const candidate = editor.property(prefix);
          const wrapped = editor.property(`${prefix}.agent`);
          if (
            !candidate?.staticallyDetermined ||
            wrapped?.staticallyDetermined === false
          )
            unknownCandidate = true;
          else if (
            !descriptor(prefix, 'agent') &&
            !descriptor(`${prefix}.agent`, 'agent')
          )
            invalidCandidate = true;
        }
        if (unknownCandidate)
          add(
            'unknown_value',
            slot,
            `A conductor ${slot} plugin supplied by an explicit slot or known addon.`,
            property,
          );
        else if (invalidCandidate)
          add(
            'invalid_value',
            slot,
            `A conductor ${slot} plugin supplied by an explicit slot or known addon.`,
            property,
          );
        continue;
      }
      if (property.nodeType !== 'ObjectExpression' || !descriptor(slot, slot))
        add(
          'invalid_value',
          slot,
          `A conductor ${slot} plugin supplied by an explicit slot or known addon.`,
          property,
        );
    }
    const findings = report.findings.slice(start);
    if (findings.some((finding) => finding.severity === 'error'))
      file.state = 'partial';
    else if (findings.some((finding) => finding.code === 'unknown_value'))
      file.state = 'computed';
  }
}

/** Resolve only documented generated wiring and primitive const bindings. Never execute code. */
export function validateConfigSources(
  options: ConfigInventoryOptions,
  texts: Map<string, string | null>,
  files: ConfigFileReport[],
): ConfigReport {
  const editors = new Map(
    [...texts]
      .filter((entry): entry is [string, string] => entry[1] !== null)
      .map(([path, text]) => [path, new ConfigSourceEditor(text)]),
  );
  const resolved = new Set<string>();
  const global = files.find((f) => f.kind === 'connection');
  const local = files.find((f) => f.kind === 'local');
  const globalEditor = global ? editors.get(global.path) : undefined;
  const localEditor = local ? editors.get(local.path) : undefined;
  const primitive = (
    e: ConfigSourceEditor | undefined,
    key: string,
  ): string | undefined => {
    const p = e?.property(key);
    return p?.staticallyDetermined && p.value !== undefined
      ? JSON.stringify(p.value)
      : undefined;
  };
  const fallback = (
    localKey: string,
    defaultExpression: string | undefined,
  ) => {
    const p = localEditor?.property(localKey);
    if (!p || (p.staticallyDetermined && p.value === null))
      return defaultExpression;
    return primitive(localEditor, localKey);
  };
  let inherits = false;
  for (const file of files) {
    const e = editors.get(file.path);
    if (!e) continue;
    const declarations = new Map<string, string>();
    for (const name of ['baseUrl', 'clientId', 'clientSecret', 'workspaceId']) {
      const match = new RegExp(`const ${name} = ([^;]+);`).exec(e.text);
      if (!match) continue;
      const value = primitive(
        new ConfigSourceEditor(`export default {value:${match[1]}};`),
        'value',
      );
      if (value !== undefined) declarations.set(name, value);
    }
    const isProject = file.kind === 'project-connection';
    const generated =
      isProject &&
      (e.text.includes('const connection = (await import(') ||
        e.text.includes('const connection = await loadConnection();'));
    if (generated) {
      inherits ||= file.selected;
      const auth = [...(globalEditor?.source.properties ?? [])]
        .find(
          ([key, p]) =>
            /^plugins\[\d+\]\.plugin$/.test(key) &&
            p.value === '@dropsh/plugin-oauth2',
        )?.[0]
        .replace(/\.plugin$/, '');
      const values: Record<string, string | undefined> = {
        baseUrl: fallback('base_url', primitive(globalEditor, 'site.base_url')),
        workspaceId: fallback(
          'workspace_id',
          primitive(globalEditor, 'workspace_id'),
        ),
        clientId: fallback(
          'oauth.client_id',
          auth ? primitive(globalEditor, `${auth}.with.client_id`) : undefined,
        ),
        clientSecret: fallback(
          'oauth.client_secret',
          auth
            ? primitive(globalEditor, `${auth}.with.client_secret`)
            : undefined,
        ),
      };
      for (const [name, value] of Object.entries(values))
        if (value !== undefined) declarations.set(name, value);
      for (const [key, name] of [
        ['site.base_url', 'baseUrl'],
        ['workspace_id', 'workspaceId'],
      ] as const) {
        const expr = e.expression(key);
        if (
          expr === name ||
          expr ===
            `local.${name === 'baseUrl' ? 'base_url' : 'workspace_id'} ?? connection.${name === 'baseUrl' ? 'site.base_url' : 'workspace_id'}`
        ) {
          const value = values[name];
          if (value !== undefined) {
            e.set(key, value);
            resolved.add(`${file.path}:${key}`);
          }
        }
      }
      if (
        e.expression('plugins')?.includes('connection.plugins.map(') &&
        globalEditor?.property('plugins')?.nodeType === 'ArrayExpression'
      ) {
        e.set('plugins', globalEditor.expression('plugins') as string);
        resolved.add(`${file.path}:plugins`);
        if (auth)
          for (const [name, value] of [
            ['client_id', values.clientId],
            ['client_secret', values.clientSecret],
          ] as const) {
            const key = `${auth}.with.${name}`;
            e.set(key, value ?? 'unknownLocalValue');
            resolved.add(`${file.path}:${key}`);
          }
      }
    }
    for (const key of [...e.source.properties.keys()]) {
      const expression = e.expression(key);
      let value = expression ? declarations.get(expression) : undefined;
      if (expression === 'local.oauth?.client_secret')
        value = primitive(localEditor, 'oauth.client_secret');
      if (value !== undefined) {
        e.set(key, value);
        resolved.add(`${file.path}:${key}`);
      }
    }
  }
  const overlay = new Map(texts);
  for (const [path, e] of editors) overlay.set(path, e.text);
  const report = inventoryConfig({ ...options, sourceTexts: overlay }).report;
  validateConductorSources(options, editors, report);
  // Literal values resolved from the local file are not secrets stored in the committed file.
  report.findings = report.findings.filter(
    (f) =>
      !(
        f.code === 'misplaced_key' &&
        f.key?.endsWith('client_secret') &&
        resolved.has(`${f.path}:${f.key}`)
      ),
  );
  // Project operations validate selected prerequisites, attributing defects to the real owner.
  if (report.resolved_scopes.includes('project')) {
    const hasProject = files.some(
      (f) => f.kind === 'project-connection' && editors.has(f.path),
    );
    for (const layer of ['machine', 'connection'] as const) {
      if (layer === 'connection' && hasProject && !inherits) continue;
      const prerequisites = inventoryConfig({
        ...options,
        scope: layer,
        sourceTexts: overlay,
      }).report;
      report.findings.push(
        ...prerequisites.findings.filter(
          (f) =>
            !report.findings.some(
              (p) => p.path === f.path && p.key === f.key && p.code === f.code,
            ),
        ),
      );
    }
  }
  // Preserve real locations; offsets in the validation-only rendering are not source locations.
  for (const f of report.findings) {
    const raw = texts.get(f.path);
    const p =
      raw && f.key ? new ConfigSourceEditor(raw).property(f.key) : undefined;
    if (p) {
      f.line = p.line;
      f.column = p.column;
    } else {
      delete f.line;
      delete f.column;
    }
  }
  return report;
}
