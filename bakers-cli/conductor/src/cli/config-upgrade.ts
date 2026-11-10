// `bakers config upgrade` version 1 → 2: rewrite the literal old key names of
// one file in place. A computed value that still carries an old name cannot be
// rewritten without running the file; it is returned for hand editing.

import {
  type ConfigKind,
  matchKeyPaths,
  OLD_NAMES,
  staticConfig,
} from '@bakers-build/core';
import type { ConfigSourceEditor } from './config-source-edit.js';

const lastSegment = (key: string) => key.replace(/^.*[.\]]/, '');
const parentOf = (key: string) => key.replace(/\.?[^.[\]]+$/, '');

/** Move `from` to `to` (different parents): set the expression, then remove. */
function move(editor: ConfigSourceEditor, from: string, to: string): boolean {
  const expression = editor.expression(from);
  if (expression === undefined) return false;
  if (editor.property(to)) return false;
  editor.set(to, expression);
  editor.remove(from);
  return true;
}

/**
 * Rewrite every literal old name of `kind` in `editor`. Returns the keys left
 * for hand editing, each with the rule's message.
 */
export function renameOldNames(
  editor: ConfigSourceEditor,
  kind: ConfigKind,
): { key: string; message: string }[] {
  const manual: { key: string; message: string }[] = [];
  for (const rule of OLD_NAMES[kind]) {
    if (rule.code !== 'renamed_key') continue;
    // Re-read after every edit: a rename shifts the spans of what follows.
    for (;;) {
      const parsed = staticConfig(editor.text);
      if (!parsed) return manual;
      const key = matchKeyPaths(parsed.value, rule.from)[0];
      if (key === undefined) break;
      const index = key.match(/\[\d+\]/)?.[0] ?? '';
      const target = rule.to?.replace('[*]', index);
      let done = false;
      if (kind === 'machine' && rule.from === 'agents.default_agent') {
        const alias = editor.property(key);
        const route = editor.property('agents.routes.default.*');
        if (alias?.staticallyDetermined && typeof alias.value === 'string') {
          if (!editor.property('agents.routes.default'))
            editor.set(
              'agents.routes.default',
              `{ '*': ${JSON.stringify(alias.value)} }`,
            );
          if (
            !route ||
            (route.staticallyDetermined && route.value === alias.value)
          ) {
            editor.remove(key);
            done = true;
          }
        }
      } else if (rule.moves && target && !editor.property(target)) {
        // Rename the block in place, then its members: comments and order stay.
        editor.rename(key, lastSegment(target));
        for (const [from, to] of rule.moves) {
          const moved = `${target}${from.slice(key.length)}`;
          if (moved !== to && editor.property(moved))
            editor.rename(moved, lastSegment(to));
        }
        done = true;
      } else if (rule.moves && !target) {
        done = rule.moves.every(([from, to]) => move(editor, from, to));
      } else if (target && parentOf(target) === parentOf(key)) {
        if (!editor.property(target)) {
          editor.rename(key, lastSegment(target));
          done = true;
        }
      } else if (target) done = move(editor, key, target);
      if (!done) {
        manual.push({ key, message: rule.message });
        break;
      }
    }
  }
  // Old names inside computed values are invisible to the rewrite above.
  const oldSegments = new Set(
    OLD_NAMES[kind]
      .filter((rule) => rule.code === 'renamed_key')
      .map((rule) => lastSegment(rule.from)),
  );
  const parsed = staticConfig(editor.text);
  for (const key of parsed?.computed ?? []) {
    const expression = editor.expression(key) ?? '';
    const hit = [...oldSegments].find((name) =>
      new RegExp(`(^|[^\\w$.])${name.replace('$', '\\$')}\\s*:`).test(
        expression,
      ),
    );
    if (hit)
      manual.push({
        key,
        message: `the computed value of ${key} still uses the old name ${hit}`,
      });
  }
  return manual;
}
