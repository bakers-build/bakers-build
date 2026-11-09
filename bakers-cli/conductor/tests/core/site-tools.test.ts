import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SITE_TOOLS } from '../../src/core/site-tools.js';

const toolsMd = new URL(
  '../../../../.claude/skills/bakers-build/skills/bb-workflow/references/tools.md',
  import.meta.url,
);

describe('site tool allowlist', () => {
  it('serves every ticket tool the skills call in a run', () => {
    const operations = readFileSync(toolsMd, 'utf8').split('## Operations')[1];
    const named = new Set(operations?.match(/bakers_[a-z_]+/g));
    // Cancelling runs stays with the operator, not with a run.
    named.delete('bakers_run_cancel');
    expect(named.size).toBeGreaterThan(5);
    expect([...named].filter((t) => !SITE_TOOLS.includes(t))).toEqual([]);
  });
});
