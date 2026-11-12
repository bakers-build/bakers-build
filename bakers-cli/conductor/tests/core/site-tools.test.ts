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
    expect(named.size).toBeGreaterThan(5);
    expect([...named].filter((t) => !SITE_TOOLS.includes(t))).toEqual([]);
  });

  it('loads a tool that is not listed yet before falling back to the CLI', () => {
    const transport =
      readFileSync(toolsMd, 'utf8')
        .split('## Transport')[1]
        ?.split('\n## ')[0] ?? '';
    const load = transport.indexOf('tool search');
    const cli = transport.indexOf('bakers tools <tool>');
    expect(load).toBeGreaterThanOrEqual(0);
    expect(cli).toBeGreaterThan(load);
    expect(transport).toContain(
      'a denied call means the tool is not loaded yet',
    );
    expect(transport).toContain('the denial covers that command only');
  });
});
