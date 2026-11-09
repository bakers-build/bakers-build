import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { checkRequiredSkills } from '../../src/core/required-skills.js';

let worktree: string;
let home: string;

const write = (path: string, content: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};
const skill = (dir: string, name: string, extra = '') =>
  write(
    join(dir, name, 'SKILL.md'),
    `---\nname: ${name}\ndescription: test\n${extra}---\n\nbody\n`,
  );

const WORKFLOW = `# WORKFLOW

## bb-phase-provision

| When | Skill |
|---|---|
| Never read | \`not-a-work-skill\` |

## bb-phase-work

Apply all matching rows.

| When | Skill |
|---|---|
| Tests | \`testing\` |
| Scenes | \`designbook:design-screen\`, or \`designbook:design-shell\` for the shell |

## bb-phase-validate

| When | Command |
|---|---|
| docs | \`pnpm build\` |
`;

beforeEach(() => {
  worktree = mkdtempSync(join(tmpdir(), 'bakers-required-wt-'));
  home = mkdtempSync(join(tmpdir(), 'bakers-required-home-'));
  write(join(worktree, 'WORKFLOW.md'), WORKFLOW);
  // Bare project skill, and a skills-directory plugin named `bakers`.
  skill(join(worktree, '.claude/skills'), 'testing');
  write(
    join(worktree, '.claude/skills/bakers-build/.claude-plugin/plugin.json'),
    '{ "name": "bakers", "skills": "./skills" }',
  );
  skill(
    join(worktree, '.claude/skills/bakers-build/skills'),
    'bb-recipe-matt',
    'metadata:\n  requires: "mattpocock-skills:grilling mattpocock-skills:tdd"\n  requires-bug: "mattpocock-skills:diagnosing-bugs mattpocock-skills:tdd"\n',
  );
  // Installed plugins in the agent home (Claude and Codex cache layouts).
  const designbook = join(home, 'plugins/cache/designbook/designbook/1.0.0');
  write(join(designbook, '.claude-plugin/plugin.json'), '{ "name": "designbook" }');
  skill(join(designbook, 'skills'), 'design-screen');
  skill(join(designbook, 'skills'), 'design-shell');
  const matt = join(home, 'plugins/cache/mattpocock/mattpocock-skills/1.3.2');
  write(
    join(matt, '.codex-plugin/plugin.json'),
    '{ "name": "mattpocock-skills", "skills": "./skills/" }',
  );
  skill(join(matt, 'skills'), 'grilling');
  skill(join(matt, 'skills'), 'tdd');
});

describe('checkRequiredSkills', () => {
  it('requires the bb-phase-work skills, conditional rows included, and the recipe with its default list', () => {
    const result = checkRequiredSkills(worktree, home, {
      type: 'feature',
      recipe: 'matt',
    });
    expect(result.required).toEqual([
      'testing',
      'designbook:design-screen',
      'designbook:design-shell',
      'bb-recipe-matt',
      'mattpocock-skills:grilling',
      'mattpocock-skills:tdd',
    ]);
    expect(result.missing).toEqual([]);
  });

  it('replaces the default list with the type list and names each missing skill', () => {
    const result = checkRequiredSkills(worktree, home, {
      type: 'bug',
      recipe: 'matt',
    });
    expect(result.missing).toEqual(['mattpocock-skills:diagnosing-bugs']);
  });

  it('matches a namespaced name only in that plugin, a bare name in any', () => {
    write(
      join(worktree, 'WORKFLOW.md'),
      '## bb-phase-work\n\n| When | Skill |\n|---|---|\n| a | `other:tdd`, `grilling` |\n',
    );
    expect(checkRequiredSkills(worktree, home, {}).missing).toEqual([
      'other:tdd',
    ]);
  });

  it('names a recipe skill that is not available', () => {
    expect(
      checkRequiredSkills(worktree, home, { type: 'feature', recipe: 'nope' })
        .missing,
    ).toEqual(['bb-recipe-nope']);
  });

  it('never counts skills of the user home', () => {
    const empty = mkdtempSync(join(tmpdir(), 'bakers-required-empty-'));
    expect(
      checkRequiredSkills(worktree, empty, { type: 'feature', recipe: 'matt' })
        .missing,
    ).toEqual([
      'designbook:design-screen',
      'designbook:design-shell',
      'mattpocock-skills:grilling',
      'mattpocock-skills:tdd',
    ]);
  });
});
