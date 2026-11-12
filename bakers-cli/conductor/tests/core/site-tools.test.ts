import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SITE_TOOLS } from '../../src/core/site-tools.js';

const toolsMd = new URL(
  '../../../../.claude/skills/bakers-build/skills/bb-workflow/references/tools.md',
  import.meta.url,
);

describe('site tool allowlist', () => {
  it('serves every ticket tool the skills call in a run', () => {
    const references = new URL('./', toolsMd);
    const operations = readdirSync(references, { recursive: true })
      .filter((path) => path.endsWith('.md'))
      .map((path) => readFileSync(new URL(path, references), 'utf8'))
      .join('\n');
    const named = new Set(operations.match(/bakers_[a-z_]+/g));
    expect(named.size).toBeGreaterThan(5);
    expect([...named].filter((t) => !SITE_TOOLS.includes(t))).toEqual([]);
  });

  it('loads a tool that is not listed yet before falling back to the CLI', () => {
    const transport = readFileSync(toolsMd, 'utf8');
    const load = transport.indexOf('tool search');
    const cli = transport.indexOf('bakers tools <tool>');
    expect(load).toBeGreaterThanOrEqual(0);
    expect(cli).toBeGreaterThan(load);
    expect(transport).toContain('Conductor denial: load/retry MCP');
    expect(transport).toContain('that command alone was denied');
    expect(transport).toContain('Prefer listed MCP');
    expect(transport).toContain('Only if not loadable');
  });
});
