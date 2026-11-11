import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

// A project WORKFLOW.md is read by the agent only; nothing in it is required.
const WORKFLOW = `# WORKFLOW

## bb-phase-work

Load \`keytec-drupal:keytec-drupal-developer\` for Drupal work.

| When | Skill |
|---|---|
| Tests | \`testing\` |
| Scenes | \`designbook:design-screen\`, or \`designbook:design-shell\` for the shell |

### Checks

| Check | \`command\` for \`ddev_exec\` |
|---|---|
| PHPCS | \`.ddev/commands/web/phpcs\` |
| E2E | \`playwright test\`, \`--project=chromium tests/<file>.spec.ts\` |
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
  // Installed plugins in the agent home: <home>/plugins/cache/<marketplace>/<plugin>/<version>.
  // designbook ships no plugin manifest (its marketplace entry carries it).
  const designbook = join(home, 'plugins/cache/designbook/designbook/a4fea9d7');
  skill(join(designbook, 'skills'), 'design-screen');
  skill(join(designbook, 'skills'), 'design-shell');
  // mattpocock lists nested skill directories in its manifest.
  const matt = join(home, 'plugins/cache/mattpocock/mattpocock-skills/1.3.2');
  write(
    join(matt, '.claude-plugin/plugin.json'),
    '{ "name": "mattpocock-skills", "skills": ["./skills/productivity/grilling", "./skills/engineering/tdd"] }',
  );
  skill(join(matt, 'skills/productivity'), 'grilling');
  skill(join(matt, 'skills/engineering'), 'tdd');
});

describe('checkRequiredSkills', () => {
  it('requires the recipe with its default list, and nothing from WORKFLOW.md', () => {
    const result = checkRequiredSkills(worktree, home, {
      type: 'feature',
      recipe: 'matt',
    });
    expect(result).toEqual({
      required: [
        'bb-recipe-matt',
        'mattpocock-skills:grilling',
        'mattpocock-skills:tdd',
      ],
      missing: [],
      sources: {
        'bb-recipe-matt': 'ticket recipe',
        'mattpocock-skills:grilling': 'bb-recipe-matt metadata.requires',
        'mattpocock-skills:tdd': 'bb-recipe-matt metadata.requires',
      },
    });
    rmSync(join(worktree, 'WORKFLOW.md'));
    expect(
      checkRequiredSkills(worktree, home, { type: 'feature', recipe: 'matt' }),
    ).toEqual(result);
  });

  it('requires nothing without a recipe, whatever WORKFLOW.md names', () => {
    expect(checkRequiredSkills(worktree, home, {})).toEqual({
      required: [],
      missing: [],
      sources: {},
    });
  });

  it('replaces the default list with the type list and names each missing skill with its source', () => {
    const result = checkRequiredSkills(worktree, home, {
      type: 'bug',
      recipe: 'matt',
    });
    expect(result.missing).toEqual(['mattpocock-skills:diagnosing-bugs']);
    expect(result.sources['mattpocock-skills:diagnosing-bugs']).toBe(
      'bb-recipe-matt metadata.requires-bug',
    );
  });

  it('matches a namespaced name only in that plugin, a bare name in any', () => {
    skill(
      join(worktree, '.claude/skills/bakers-build/skills'),
      'bb-recipe-ns',
      'metadata:\n  requires: "other:tdd grilling"\n',
    );
    expect(
      checkRequiredSkills(worktree, home, { recipe: 'ns' }).missing,
    ).toEqual(['other:tdd']);
  });

  it('names a recipe skill that is not available', () => {
    const result = checkRequiredSkills(worktree, home, {
      type: 'feature',
      recipe: 'nope',
    });
    expect(result.missing).toEqual(['bb-recipe-nope']);
    expect(result.sources['bb-recipe-nope']).toBe('ticket recipe');
  });

  it('finds every SKILL.md below a manifest path, as Codex lists `./` for a manifest-less plugin', () => {
    const codexHome = mkdtempSync(join(tmpdir(), 'bakers-required-codex-'));
    const root = join(codexHome, 'plugins/cache/designbook/designbook/local');
    write(
      join(root, '.codex-plugin/plugin.json'),
      '{ "name": "designbook", "skills": ["./"] }',
    );
    skill(join(root, 'skills'), 'design-screen');
    skill(join(root, 'skills'), 'design-shell');
    skill(
      join(worktree, '.claude/skills/bakers-build/skills'),
      'bb-recipe-db',
      'metadata:\n  requires: "designbook:design-screen designbook:design-shell"\n',
    );
    expect(
      checkRequiredSkills(worktree, codexHome, { recipe: 'db' }).missing,
    ).toEqual([]);
  });

  it('never counts skills of the user home', () => {
    const empty = mkdtempSync(join(tmpdir(), 'bakers-required-empty-'));
    expect(
      checkRequiredSkills(worktree, empty, { type: 'feature', recipe: 'matt' })
        .missing,
    ).toEqual(['mattpocock-skills:grilling', 'mattpocock-skills:tdd']);
  });
});
