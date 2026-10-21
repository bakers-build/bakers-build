import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  UI_COLLECTION_EXCEPTIONS,
  WORKSPACE_READ_SCOPE_PATHS,
} from '@bakers-build/addon-workspace';
import { describe, expect, it } from 'vitest';

// BB-495 D5: "be sure the filter applies everywhere" is a requirement that
// care alone cannot satisfy — this derives the collections the UI reads FROM
// THE SOURCE TREE, so a domain module or screen added later is caught without
// anyone remembering to update a checklist here.

const SOURCE_ROOT = fileURLToPath(new URL('../src', import.meta.url));

/** Every TypeScript source file that can contain a client call. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))
        out.push(path);
    }
  };
  walk(SOURCE_ROOT);
  return out;
}

/** Strip comments so a doc comment mentioning `client.get(...)` cannot fake a call site. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** Resolve a same-file `export const NAME = 'literal';` to its string value. */
function localConstants(text: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /export const ([A-Z0-9_]+)\s*=\s*['"]([^'"]+)['"]/g;
  for (const m of text.matchAll(re)) map.set(m[1] as string, m[2] as string);
  return map;
}

const CALL_RE =
  /(?:client\s*\.\s*(?:get|collection|resource)|loadPage\(\s*client,)\s*\(?\s*(?:client,\s*)?(?:[`'"]([^`'"]*)[`'"]|([A-Z0-9_]+)\s*[,)])/g;

/**
 * Every `entity_type` (the `WORKSPACE_READ_SCOPE_PATHS` key shape) the UI
 * reads via `client.get(...)`, `client.collection(...)`, `client.resource(...)`,
 * or the shared `loadPage(client, ...)` helper. A call site's resource path is
 * a string/template literal (`'bb_ticket/bb_ticket'`,
 * `` `bakers/statistics/${id}` ``) or a same-file constant it was assigned from
 * (`MEMBERSHIP_RESOURCE`). `bakers/statistics` is kept as its full bespoke path
 * rather than collapsed to `bakers` — it is not an entity type at all.
 */
function collectionsReadByUi(): string[] {
  const found = new Set<string>();
  for (const file of sourceFiles()) {
    const raw = readFileSync(file, 'utf8');
    const constants = localConstants(raw);
    const text = stripComments(raw);
    for (const m of text.matchAll(CALL_RE)) {
      let path = m[1] ?? m[2];
      if (!path) continue;
      if (/^[A-Z0-9_]+$/.test(path) && constants.has(path))
        path = constants.get(path) as string;
      const cleaned = (path.split('?')[0] ?? '')
        .replace(/\$\{.*/, '')
        .replace(/\/+$/, '');
      if (!cleaned) continue;
      const [head, ...rest] = cleaned.split('/');
      if (!head) continue;
      found.add(head === 'bakers' ? [head, ...rest].join('/') : head);
    }
  }
  return [...found];
}

describe('every UI collection is workspace-scoped or a recorded exception (BB-495 D5)', () => {
  it('the scanner sees every collection the UI is known to read (regression pin)', () => {
    // Pins the scanner itself against a known set, so a change to its own
    // regex is caught the same way a new, unscoped screen would be.
    const collections = collectionsReadByUi();
    for (const known of [
      'bb_conductor',
      'bb_team',
      'bb_ticket',
      'bb_workspace',
      'bb_project',
      'bb_run',
      'user',
      'bakers/statistics',
      'og_membership',
    ]) {
      expect(collections).toContain(known);
    }
  });

  it('every UI collection is covered by WORKSPACE_READ_SCOPE_PATHS or a recorded exception', () => {
    const collections = collectionsReadByUi();
    const covered = new Set(Object.keys(WORKSPACE_READ_SCOPE_PATHS));
    const exempt = new Set(UI_COLLECTION_EXCEPTIONS);
    const uncovered = collections.filter(
      (c) => !covered.has(c) && !exempt.has(c),
    );
    expect(uncovered).toEqual([]);
  });

  // BB-495 D5 Step 5: prove the gate actually bites. `bb_invite` is a
  // real, scoped bakers.build entity type (WORKSPACE_READ_SCOPE_PATHS does not list
  // it), so treating it as "read by the UI" must fail rather than pass quietly.
  it('fails when an uncovered collection is present, naming it', () => {
    const covered = new Set(Object.keys(WORKSPACE_READ_SCOPE_PATHS));
    const exempt = new Set(UI_COLLECTION_EXCEPTIONS);
    const probed = [...collectionsReadByUi(), 'bb_invite'];
    const uncovered = probed.filter((c) => !covered.has(c) && !exempt.has(c));
    expect(uncovered).toEqual(['bb_invite']);
  });
});
