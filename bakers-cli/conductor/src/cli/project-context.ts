import {
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename } from 'node:path';
import { ConfigSourceEditor } from './config-source-edit.js';

export interface BbWorkspaceOwner {
  path: string;
  before: string;
}

export interface BbProjectSelection {
  project: string;
  workspace?: string;
}

export type BbProjectOwner = BbWorkspaceOwner;

/** Read committed bakers.build identity without executing conductor source. */
export function readBbProjectSelection(path: string): BbProjectSelection {
  const editor = new ConfigSourceEditor(readFileSync(path, 'utf8'));
  const invalid = () =>
    new Error(
      `Cannot read committed bakers.project in ${path}; run bakers config upgrade --scope project.`,
    );
  const bakers = editor.property('bakers');
  const bakersExpression = editor.expression('bakers');
  const bakersHasSpread = bakersExpression
    ? new ConfigSourceEditor(`export default ${bakersExpression};`).source
        .unknownKeys
    : false;
  const project = editor.property('bakers.project');
  const workspace = editor.property('bakers.workspace');
  if (
    editor.source.shape !== 'object' ||
    bakersHasSpread ||
    editor.property('project') ||
    editor.property('bb_workspace') ||
    bakers?.nodeType !== 'ObjectExpression' ||
    !project?.staticallyDetermined ||
    typeof project.value !== 'string' ||
    !project.value.trim() ||
    (workspace !== undefined &&
      (!workspace.staticallyDetermined ||
        typeof workspace.value !== 'string' ||
        !workspace.value.trim()))
  )
    throw invalid();
  return {
    project: project.value.trim(),
    ...(workspace ? { workspace: (workspace.value as string).trim() } : {}),
  };
}

/** Establish the exact file that can receive a nested workspace choice. */
export function bakersProjectOwner(path: string): BbProjectOwner {
  const file = basename(path);
  if (file !== 'conductor.config.js' && !file.endsWith('.conductor.config.js'))
    throw new Error(
      `Cannot write bakers.build workspace selection to ${path}.`,
    );
  readBbProjectSelection(path);
  return { path, before: readFileSync(path, 'utf8') };
}

/** Read the committed project name without executing engine config. */
export function readProjectSelection(path: string): string | undefined {
  try {
    const property = new ConfigSourceEditor(
      readFileSync(path, 'utf8'),
    ).property('project');
    return property?.staticallyDetermined &&
      typeof property.value === 'string' &&
      property.value.trim() !== ''
      ? property.value.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

/** Read the committed product-workspace name without executing engine config. */
export function readBbWorkspaceSelection(path: string): string | undefined {
  try {
    const property = new ConfigSourceEditor(
      readFileSync(path, 'utf8'),
    ).property('bb_workspace');
    return property?.staticallyDetermined &&
      typeof property.value === 'string' &&
      property.value.trim() !== ''
      ? property.value.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

/** Establish the conductor-owned source that the cockpit may update. */
export function bakersWorkspaceOwner(path: string): BbWorkspaceOwner {
  const file = basename(path);
  if (file !== 'conductor.config.js' && !file.endsWith('.conductor.config.js'))
    throw new Error(
      `Cannot write bakers.build workspace selection to ${path}; expected conductor.config.js or a named conductor variant. No configuration was written.`,
    );
  const before = readFileSync(path, 'utf8');
  const editor = new ConfigSourceEditor(before);
  const property = editor.property('bb_workspace');
  if (
    editor.source.shape === 'object' &&
    !editor.source.unknownKeys &&
    (!property ||
      (property.staticallyDetermined && typeof property.value === 'string'))
  )
    return { path, before };
  throw new Error(
    `Cannot establish a literal writable bb_workspace in ${path}. No configuration was written.`,
  );
}

/** Atomically update only the product-workspace field, preserving plugin slots. */
export async function writeBbWorkspaceSelection(
  owner: BbWorkspaceOwner,
  selected: string,
  hint: string,
): Promise<void> {
  const editor = new ConfigSourceEditor(owner.before);
  editor.set(
    editor.property('bakers.project') ? 'bakers.workspace' : 'bb_workspace',
    JSON.stringify(selected),
  );
  if (
    (existsSync(owner.path) ? readFileSync(owner.path, 'utf8') : null) !==
    owner.before
  )
    throw new Error(
      `Configuration changed while choosing; recheck ${owner.path} before retrying. No configuration was written.`,
    );
  const temporary = `${owner.path}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temporary, editor.text, {
      mode: statSync(owner.path).mode & 0o777,
      flag: 'wx',
    });
    renameSync(temporary, owner.path);
  } catch {
    if (existsSync(temporary)) unlinkSync(temporary);
    throw new Error(
      `Could not write bakers.build workspace to ${owner.path}. ${hint}`,
    );
  }
}
