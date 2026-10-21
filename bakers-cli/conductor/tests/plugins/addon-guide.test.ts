import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateResult } from '@bakers-build/message';
import { describe, expect, it } from 'vitest';
import { loadInbox } from '../../src/plugins/message.js';

// docs/addons/build/actions.md builds an addon step by step.
// These tests run the guide's own code blocks, so a drift in the guide fails
// here (.gitlab-ci.yml lists the guide under the conductor job's changes).

/** The guide's `## Write the addon` section. */
function guideSection(): string {
  const guide = readFileSync(
    new URL('../../../../docs/addons/build/actions.md', import.meta.url),
    'utf8',
  );
  return guide.split('## Write the addon\n')[1]?.split('\n## ')[0] ?? '';
}

/** The guide's ```ts block that starts with `// <file>`, unindented, as plain JS. */
function guideBlock(file: string): string {
  const block = [...guideSection().matchAll(/^( *)```ts\n([\s\S]*?)^\1```/gm)]
    .map(([, indent, body]) => body.replace(new RegExp(`^${indent}`, 'gm'), ''))
    .find((b) => b.startsWith(`// ${file}\n`));
  if (!block) throw new Error(`guide has no block for ${file}`);
  return block
    .replace(/^import type .*\n/m, '')
    .replace(": Preset['inbox']", '')
    .replace(': Record<string, InboxMessageHandler>', '');
}

describe('addon guide (addon-actions.md)', () => {
  it('loads and runs the addon built in the guide', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bakers-addon-guide-'));
    try {
      writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
      writeFileSync(join(dir, 'preset.js'), guideBlock('src/preset.ts'));
      writeFileSync(join(dir, 'handlers.js'), guideBlock('src/handlers.ts'));
      const { inbox } = await import(
        pathToFileURL(join(dir, 'preset.js')).href
      );
      const loaded = await loadInbox({
        name: 'hello',
        version: '0.1.0',
        inbox,
      });

      const result = await loaded.handlers.greet?.({
        id: 'req-1',
        messageType: 'hello.greet',
        addonVersion: '0.1.0',
        requestedBy: 'user-1',
        ticket: {} as never,
        payload: { name: 'Ada' },
        worktreePath: '/tmp/wt',
        env: {},
        logger: console as never,
        signal: new AbortController().signal,
      });
      expect(result?.markdown).toBe('Hello, Ada!');
      expect(validateResult(result)).toEqual({ ok: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // The conductor resolves addons from its own install, where the workspace
  // fixture addon-fake resolves; the guide must register the addon there too.
  it('registers the guide addon where the conductor resolves addon-fake', () => {
    const target = guideSection()
      .split('\n4. ')[1]
      ?.split('\n5. ')[0]
      ?.match(/`(bakers-cli\/[\w/.-]*package\.json)`/)?.[1];
    expect(target).toBeDefined();
    const pkg = JSON.parse(
      readFileSync(new URL(`../../../../${target}`, import.meta.url), 'utf8'),
    );
    expect({
      ...pkg.dependencies,
      ...pkg.devDependencies,
    }).toHaveProperty(['@bakers-build/addon-fake']);
  });
});
