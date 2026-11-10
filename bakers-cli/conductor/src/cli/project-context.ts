import {
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename } from 'node:path';
import { stemForConfigFile } from '@bakers-build/core';
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

/**
 * Read the committed `project: { name, workspace }` without executing the
 * file. `BAKERS_PROJECT` overrides the name for this process.
 */
export function readBbProjectSelection(
  path: string,
  env: NodeJS.ProcessEnv = process.env,
): BbProjectSelection {
  const editor = new ConfigSourceEditor(readFileSync(path, 'utf8'));
  const invalid = () =>
    new Error(
      `Cannot read the committed project in ${path}; set project: { name: '<name>' } as a literal object without spreads.`,
    );
  const block = editor.property('project');
  const blockExpression = editor.expression('project');
  const hasSpread = blockExpression
    ? new ConfigSourceEditor(`export default ${blockExpression};`).source
        .unknownKeys
    : false;
  const override = env.BAKERS_PROJECT?.trim();
  const name = editor.property('project.name');
  const workspace = editor.property('project.workspace');
  const literal = (p: typeof name) =>
    p?.staticallyDetermined &&
    typeof p.value === 'string' &&
    p.value.trim() !== '';
  if (
    editor.source.shape !== 'object' ||
    hasSpread ||
    block?.nodeType !== 'ObjectExpression' ||
    (!override && !literal(name)) ||
    (workspace !== undefined && !literal(workspace))
  )
    throw invalid();
  return {
    project: override || String(name?.value).trim(),
    ...(workspace ? { workspace: (workspace.value as string).trim() } : {}),
  };
}

/** Establish the exact file that can receive a nested workspace choice. */
export function bakersProjectOwner(path: string): BbProjectOwner {
  if (stemForConfigFile(basename(path)) === undefined)
    throw new Error(
      `Cannot write bakers.build workspace selection to ${path}; expected project.config.js or a project.<name>.config.js variant. No configuration was written.`,
    );
  readBbProjectSelection(path);
  return { path, before: readFileSync(path, 'utf8') };
}

/** Atomically update only the product-workspace field, preserving plugin slots. */
export async function writeBbWorkspaceSelection(
  owner: BbWorkspaceOwner,
  selected: string,
  hint: string,
): Promise<void> {
  const editor = new ConfigSourceEditor(owner.before);
  editor.set('project.workspace', JSON.stringify(selected));
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
