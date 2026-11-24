import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { unprotectedEntryPoints } from '../core/host-commands.js';
import type {
  ConfigSourceInspection,
  ConfigSourceProperty,
} from './config-source.js';

const DOCS = 'https://bakers.build/provision/hooks#protect-host-executed-files';

export interface ProtectedPathProblem {
  key: string;
  expected: string;
  remediation: string;
  property: ConfigSourceProperty;
}

const staticStrings = (
  source: ConfigSourceInspection | undefined,
  pattern: RegExp,
): ConfigSourceProperty[] =>
  [...(source?.properties.values() ?? [])].filter(
    (p) =>
      pattern.test(p.key) &&
      p.staticallyDetermined &&
      typeof p.value === 'string',
  );

/**
 * shortcut: offline cannot import addons to read `isolates`, so any catalog
 * runtime or `addon-runtime-*` addon counts as isolating (every shipped one
 * does); upgrade once runtime addons declare `isolates` in package metadata.
 */
function isolating(
  project: ConfigSourceInspection,
  machine: ConfigSourceInspection | undefined,
): boolean {
  const machineRuntime =
    staticStrings(machine, /^runtime\.catalog\[\d+\]\.use$/).length > 0 ||
    staticStrings(machine, /^addons\[\d+\](\.use)?$/).some((p) =>
      String(p.value).includes('addon-runtime-'),
    );
  if (!machineRuntime) return false;
  if (!project.properties.has('runtime.enabled')) return true;
  return staticStrings(project, /^runtime\.enabled\[\d+\]$/).some(
    (p) => p.value !== 'system',
  );
}

/** Statically visible faults the conductor would refuse at start or dispatch. */
export function protectedPathProblems(
  project: ConfigSourceInspection,
  machine: ConfigSourceInspection | undefined,
  projectRoot: string,
): ProtectedPathProblem[] {
  const problems: ProtectedPathProblem[] = [];
  const readOnly = staticStrings(project, /^runtime\.read_only\[\d+\]$/);
  for (const property of readOnly) {
    if (!existsSync(join(projectRoot, String(property.value))))
      problems.push({
        key: property.key,
        expected: `runtime.read_only path ${property.value} exists in ${projectRoot}`,
        remediation: `Create ${property.value} in ${projectRoot} or remove it from runtime.read_only.`,
        property,
      });
  }
  if (!isolating(project, machine)) return problems;
  const commands = new Map<string, ConfigSourceProperty>();
  for (const property of staticStrings(
    project,
    /^hooks\.[^.[\]]+(\.[^.[\]]+)?(\.command)?$/,
  )) {
    // Only `hooks.<name>.<key>.command` is an entry's field; `hooks.<name>.command` is an entry.
    const key =
      property.key.split('.').length === 4
        ? property.key.replace(/\.command$/, '')
        : property.key;
    commands.set(key, property);
  }
  for (const { key, roots } of unprotectedEntryPoints(
    [...commands].map(([key, p]) => [key, String(p.value)] as const),
    readOnly.map((p) => String(p.value)),
  ))
    problems.push({
      key,
      expected: `${key}: under an isolating runtime a host command starts with a script in a protected path (${roots.join(', ')})`,
      remediation: `Move the command into a script under .bakers (or a runtime.read_only path) and call it with bash; see ${DOCS}.`,
      property: commands.get(key) as ConfigSourceProperty,
    });
  return problems;
}
