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
 * downgrades a genuinely missing server/executor/worktree from
 * `missing_required_key` to `unknown_value`.
 */
export const CONDUCTOR_ADDON_SLOTS: Record<string, string[]> = {
  '@bakers-build/addon-remote-drupal': ['server'],
  '@bakers-build/addon-herdr': ['executor', 'worktree'],
  '@bakers-build/addon-orca': ['executor', 'worktree'],
  '@bakers-build/addon-herdr-core': ['executor'],
  '@bakers-build/addon-fake': ['server', 'executor', 'worktree'],
  '@bakers-build/addon-workspace-git': ['worktree'],
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
  '@bakers-build/addon-forge': [],
  '@bakers-build/addon-forge-github': [],
  '@bakers-build/addon-forge-gitlab': [],
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
  for (const file of report.files.filter(
    (candidate) => candidate.selected && candidate.kind === 'project',
  )) {
    const editor = editors.get(file.path);
    if (editor?.source.shape !== 'object') continue;
    const start = report.findings.length;
    // Field shapes are the schema's; only what a schema cannot know is here:
    // which slots the listed addons fill.
    const add = (
      code: ConfigFinding['code'],
      key: string,
      expected: string,
      property = editor.property(key),
    ) => {
      const unknown = code === 'unknown_value';
      report.findings.push({
        code,
        severity: unknown ? 'warning' : 'error',
        stage: 'schema',
        path: file.path,
        key,
        expected,
        observed: unknown ? '[COMPUTED]' : (property?.value ?? null),
        owner: 'project',
        related: [],
        statically_determined: property?.staticallyDetermined ?? false,
        remediation: `${unknown ? 'Determine' : 'Set'} ${key} in ${shellQuote(file.path)}, then run ${recheck}.`,
        recheck,
        ...(property ? { line: property.line, column: property.column } : {}),
      });
    };
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
    for (const slot of ['server', 'executor', 'worktree']) {
      if (editor.property(slot) || addonSlots.has(slot)) continue;
      add(
        addon && addonsAreOpaque ? 'unknown_value' : 'missing_required_key',
        slot,
        `A ${slot} supplied by an explicit slot or a listed addon.`,
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
  const globalEditor = global ? editors.get(global.path) : undefined;
  const primitive = (
    e: ConfigSourceEditor | undefined,
    key: string,
  ): string | undefined => {
    const p = e?.property(key);
    return p?.staticallyDetermined && p.value !== undefined
      ? JSON.stringify(p.value)
      : undefined;
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
        baseUrl: primitive(globalEditor, 'site.base_url'),
        workspaceId: primitive(globalEditor, 'workspace_id'),
        clientId: auth
          ? primitive(globalEditor, `${auth}.with.client_id`)
          : undefined,
        clientSecret: auth
          ? primitive(globalEditor, `${auth}.with.client_secret`)
          : undefined,
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
      const value = expression ? declarations.get(expression) : undefined;
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
  // Literal values resolved from generated wiring are not secrets stored in the committed file.
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
