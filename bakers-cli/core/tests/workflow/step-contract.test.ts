import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  deriveProjectTriples,
  expandLoad,
  measureEmptyLoader,
  parseStepValues,
  readSkillWhen,
  type SkillContract,
  StepContractError,
  type StepValues,
  type Triple,
  validateLoad,
} from '../../src/workflow/step-contract.js';

const HERE = dirname(fileURLToPath(import.meta.url));
// tests/workflow -> tests -> core -> conductor -> repo root
const REPO_ROOT = resolve(HERE, '../../../..');
const SKILLS_DIR = resolve(REPO_ROOT, '.claude/skills/bakers-build/skills');
const WORKFLOW_MD = resolve(REPO_ROOT, 'WORKFLOW.md');
const TEMPLATE_MD = resolve(
  REPO_ROOT,
  '.claude/skills/bakers-build/templates/WORKFLOW.template.md',
);
const README_MD = resolve(REPO_ROOT, '.claude/skills/bakers-build/README.md');
const CONVENTIONS_MD = resolve(REPO_ROOT, 'CONVENTIONS.md');
const CONVENTIONS_TEMPLATE_MD = resolve(
  REPO_ROOT,
  '.claude/skills/bakers-build/templates/CONVENTIONS.template.md',
);
const WORKFLOWS_YML = resolve(
  REPO_ROOT,
  'web/modules/custom/bb_core/bb_core.workflows.yml',
);

const read = (p: string) => readFileSync(p, 'utf8');
// Expand shipped local references at their pointer so contracts test reached instructions.
function readInstructions(path: string, parents: string[] = []): string {
  if (parents.includes(path))
    throw new Error(`Cyclic instruction reference: ${path}`);
  return read(path).replace(
    /\[[^\]]+\]\(([^)]+\.md)\)/g,
    (link, target: string) => {
      if (
        !/^(?:\.\.\/|references\/)[\w./-]+\.md$/.test(target) ||
        !target.includes('references/')
      )
        return link;
      return `\n${readInstructions(resolve(dirname(path), target), [...parents, path])}\n`;
    },
  );
}
const readSkill = (name: string) =>
  readInstructions(resolve(SKILLS_DIR, name, 'SKILL.md'));

describe('parseStepValues (inline per-skill values)', () => {
  const md = [
    '# bakers.build — WORKFLOW',
    '',
    '## Loaded skills',
    '',
    'intro prose ignored',
    '',
    '- @bakers-build/qualify-ticket',
    '- @bakers-build/ddev-drupal-bug',
    '    validate.command: "ddev bakers-test-e2e"',
    '    build.prompt: |',
    '      line one',
    '      line two',
    '- @bakers-build/docs-authoring',
    '    validate.command: "pnpm lint"',
    '',
    'trailing note ignored',
    '',
    '## Something else',
  ].join('\n');

  it('reads values keyed by skill name, stripping @bakers-build/', () => {
    const v = parseStepValues(md);
    expect(v['ddev-drupal-bug']['validate.command']).toBe(
      'ddev bakers-test-e2e',
    );
    expect(v['docs-authoring']['validate.command']).toBe('pnpm lint');
  });

  it('a bullet with no inline values maps to an empty object', () => {
    expect(parseStepValues(md)['qualify-ticket']).toEqual({});
  });

  it('reads a multi-line block scalar', () => {
    expect(parseStepValues(md)['ddev-drupal-bug']['build.prompt']).toBe(
      'line one\nline two\n',
    );
  });

  it('throws when there is no Loaded skills section', () => {
    expect(() => parseStepValues('# W\n\nno section')).toThrow(
      StepContractError,
    );
  });

  it('rejects a non-string inline value', () => {
    const bad = '## Loaded skills\n\n- @bakers-build/x\n    n: 5\n';
    expect(() => parseStepValues(bad)).toThrow(/must be a string/);
  });
});

describe('readSkillWhen', () => {
  const skill = (fm: string, body = '\n# Body\n') => `---\n${fm}\n---${body}`;

  it('reads a full when triple + inputs', () => {
    const c = readSkillWhen(
      skill(
        'name: ddev-drupal-bug\nwhen:\n  work_type: code\n  workflow: [bb_bug]\n  step: [diagnose, coding, review]\ninputs: [validate, provision]',
      ),
    );
    expect(c.name).toBe('ddev-drupal-bug');
    expect(c.when?.work_type).toEqual(['code']);
    expect(c.when?.workflow).toEqual(['bb_bug']);
    expect(c.when?.step).toEqual(['diagnose', 'coding', 'review']);
    expect(c.inputs.map((i) => i.key)).toEqual(['validate', 'provision']);
  });

  it('reads map inputs with description + default', () => {
    const c = readSkillWhen(
      skill(
        'name: x\ninputs:\n  test.command:\n    description: runs the e2e suite\n    default: ddev bakers-test-e2e',
      ),
    );
    expect(c.inputs).toEqual([
      {
        key: 'test.command',
        description: 'runs the e2e suite',
        default: 'ddev bakers-test-e2e',
      },
    ]);
  });

  it('treats omitted work_type as any (undefined)', () => {
    const c = readSkillWhen(
      skill(
        'name: qualify-ticket\nwhen:\n  workflow: [bb_feature]\n  step: [qualification]',
      ),
    );
    expect(c.when?.work_type).toBeUndefined();
  });

  it('accepts the * wildcard', () => {
    const c = readSkillWhen(
      skill('name: x\nwhen:\n  workflow: "*"\n  step: coding'),
    );
    expect(c.when?.workflow).toBe('*');
    expect(c.when?.step).toEqual(['coding']);
  });

  it('returns no when for a helper skill', () => {
    const c = readSkillWhen(skill('name: read-ticket'));
    expect(c.when).toBeUndefined();
    expect(c.inputs).toEqual([]);
  });

  it('rejects an unknown step value', () => {
    expect(() =>
      readSkillWhen(skill('name: x\nwhen:\n  step: [nope]')),
    ).toThrow(/not a known workflow step/);
  });

  it('rejects an unrecognized when key', () => {
    expect(() =>
      readSkillWhen(skill('name: x\nwhen:\n  phase: coding')),
    ).toThrow(/not a recognized key/);
  });

  it('rejects missing frontmatter', () => {
    expect(() => readSkillWhen('# no frontmatter')).toThrow(StepContractError);
  });

  const bundleBody = (...bullets: string[]) =>
    `\n# Body\n\n## Loaded skills\n\n${bullets.join('\n')}\n`;

  it('reads a bundle from its body section, not from frontmatter', () => {
    const c = readSkillWhen(
      skill(
        'name: essential-skills',
        bundleBody(
          '- @bakers-build/qualify-ticket',
          '- @bakers-build/create-spec',
        ),
      ),
    );
    expect(c.name).toBe('essential-skills');
    expect(c.loads).toEqual(['qualify-ticket', 'create-spec']);
    expect(c.when).toBeUndefined();
    expect(c.inputs).toEqual([]);
  });

  it('reads a bundle member value written inline under its bullet', () => {
    const c = readSkillWhen(
      skill(
        'name: essential-skills',
        bundleBody(
          '- @bakers-build/qualify-ticket',
          '- @bakers-build/post-deployment',
          '    health: curl -sf $BASE/health',
        ),
      ),
    );
    expect(c.values?.['post-deployment']).toEqual({
      health: 'curl -sf $BASE/health',
    });
    expect(c.values?.['qualify-ticket']).toEqual({});
  });

  it('a plain skill carries no loads and no values', () => {
    const c = readSkillWhen(skill('name: read-ticket'));
    expect(c.loads).toBeUndefined();
    expect(c.values).toBeUndefined();
  });

  it('rejects a bundle that also declares when', () => {
    expect(() =>
      readSkillWhen(
        skill(
          'name: b\nwhen:\n  step: coding',
          bundleBody('- @bakers-build/x'),
        ),
      ),
    ).toThrow(/must declare no `when`/);
  });

  it('rejects a bundle that also declares inputs', () => {
    expect(() =>
      readSkillWhen(
        skill('name: b\ninputs: [validate]', bundleBody('- @bakers-build/x')),
      ),
    ).toThrow(/no .*inputs|takes none itself/);
  });

  it('rejects a bundle whose Loaded skills section lists nothing', () => {
    expect(() =>
      readSkillWhen(
        skill('name: b', '\n# Body\n\n## Loaded skills\n\nnone.\n'),
      ),
    ).toThrow(/lists no skill/);
  });
});

describe('validateLoad (per-skill value resolution)', () => {
  const values = {
    'ddev-drupal-bug': {
      'validate.command': 'run',
      'provision.command': 'init',
    },
  };
  const owner = (name: string, when: unknown, inputs: string[] = []) =>
    ({ name, when, inputs }) as never;

  const bugSkill = owner(
    'ddev-drupal-bug',
    { work_type: ['code'], workflow: ['bb_bug'], step: ['coding'] },
    [{ key: 'validate.command' }, { key: 'provision.command' }],
  );
  const qualSkill = owner('qualify-ticket', {
    work_type: undefined,
    workflow: ['bb_bug'],
    step: ['qualification'],
  });

  it('passes when every triple matches exactly one skill', () => {
    const triples: Triple[] = [
      { work_type: 'code', workflow: 'bb_bug', step: 'coding' },
      { work_type: null, workflow: 'bb_bug', step: 'qualification' },
    ];
    expect(() =>
      validateLoad([bugSkill, qualSkill], values, triples),
    ).not.toThrow();
  });

  it('throws on a coverage gap', () => {
    const triples: Triple[] = [
      { work_type: 'code', workflow: 'bb_bug', step: 'review' },
    ];
    expect(() => validateLoad([qualSkill], values, triples)).toThrow(
      /coverage gap/,
    );
  });

  it('throws on a collision naming both skills', () => {
    const dup = owner('other-code-bug-skill', {
      work_type: ['code'],
      workflow: ['bb_bug'],
      step: ['coding'],
    });
    const triples: Triple[] = [
      { work_type: 'code', workflow: 'bb_bug', step: 'coding' },
    ];
    expect(() => validateLoad([bugSkill, dup], values, triples)).toThrow(
      /collision/,
    );
  });

  it('throws naming a missing per-skill input value', () => {
    const triples: Triple[] = [
      { work_type: 'code', workflow: 'bb_bug', step: 'coding' },
    ];
    expect(() =>
      validateLoad(
        [bugSkill],
        { 'ddev-drupal-bug': { 'validate.command': 'run' } },
        triples,
      ),
    ).toThrow(/provision\.command/);
  });

  it('uses the skill default when WORKFLOW.md sets no override', () => {
    const withDefault = owner(
      'ddev-drupal-bug',
      { work_type: ['code'], workflow: ['bb_bug'], step: ['coding'] },
      [{ key: 'validate.command', default: 'ddev bakers-test-e2e' }],
    );
    const triples: Triple[] = [
      { work_type: 'code', workflow: 'bb_bug', step: 'coding' },
    ];
    // no overrides in WORKFLOW.md at all -> default satisfies the input
    expect(() => validateLoad([withDefault], {}, triples)).not.toThrow();
  });

  it('ignores helper skills that declare no when', () => {
    const helper = owner('read-ticket', undefined);
    const triples: Triple[] = [
      { work_type: null, workflow: 'bb_bug', step: 'qualification' },
    ];
    expect(() =>
      validateLoad([helper, qualSkill], values, triples),
    ).not.toThrow();
  });
});

describe('surface area — pure parse/validate only, no merge/dispatch/routing', () => {
  it('exports no merge or routing API', async () => {
    const mod = await import('../../src/workflow/step-contract.js');
    const names = Object.keys(mod);
    expect(names).toEqual(
      expect.arrayContaining([
        'parseStepValues',
        'expandLoad',
        'readSkillWhen',
        'validateLoad',
        'StepContractError',
        'WORKFLOW_STEPS',
      ]),
    );
    for (const banned of [
      'merge',
      'dispatch',
      'route',
      'routing',
      'assemble',
      'apply',
    ]) {
      expect(names.some((n) => n.toLowerCase().includes(banned))).toBe(false);
    }
  });
});

/** Build a minimal loader document from `## Loaded skills` bullet lines. */
const loaderMd = (...lines: string[]) =>
  ['# W', '', '## Loaded skills', '', ...lines, '', '## Next'].join('\n');

describe('expandLoad (dedup + cycle + missing + value precedence)', () => {
  const bundle = (
    name: string,
    loads: string[],
    values: StepValues = {},
  ): SkillContract => ({ name, inputs: [], loads, values }) as SkillContract;
  const owner = (name: string): SkillContract =>
    ({
      name,
      inputs: [],
      when: { work_type: undefined, workflow: '*', step: ['coding'] },
    }) as SkillContract;
  const map = (...s: SkillContract[]) =>
    new Map(s.map((x) => [x.name, x] as const));

  const essential = bundle('essential-skills', [
    'qualify-ticket',
    'create-spec',
  ]);
  const byName = map(
    essential,
    owner('qualify-ticket'),
    owner('create-spec'),
    owner('ddev-drupal-bug'),
  );
  const names = (r: { skills: SkillContract[] }) => r.skills.map((s) => s.name);

  it('expands a bundle into its members in declared order', () => {
    expect(
      names(
        expandLoad(
          loaderMd(
            '- @bakers-build/essential-skills',
            '- @bakers-build/ddev-drupal-bug',
          ),
          byName,
        ),
      ),
    ).toEqual(['qualify-ticket', 'create-spec', 'ddev-drupal-bug']);
  });

  it('is idempotent: the bundle listed twice dedups (first occurrence)', () => {
    expect(
      names(
        expandLoad(
          loaderMd(
            '- @bakers-build/essential-skills',
            '- @bakers-build/essential-skills',
          ),
          byName,
        ),
      ),
    ).toEqual(['qualify-ticket', 'create-spec']);
  });

  it('dedups a bundle plus one member listed explicitly', () => {
    expect(
      names(
        expandLoad(
          loaderMd(
            '- @bakers-build/essential-skills',
            '- @bakers-build/create-spec',
          ),
          byName,
        ),
      ),
    ).toEqual(['qualify-ticket', 'create-spec']);
  });

  it('throws when the document carries no Loaded skills section', () => {
    expect(() => expandLoad('# W\n\nnope', byName)).toThrow(StepContractError);
  });

  it('throws naming an unknown bundle member (AC7)', () => {
    const bad = map(bundle('essential-skills', ['nope']));
    expect(() =>
      expandLoad(loaderMd('- @bakers-build/essential-skills'), bad),
    ).toThrow(/nope/);
  });

  it('throws naming an unknown root skill', () => {
    expect(() => expandLoad(loaderMd('- @bakers-build/ghost'), byName)).toThrow(
      /ghost/,
    );
  });

  it('throws naming the cycle path for a cyclic bundle graph (AC7)', () => {
    const cyclic = map(bundle('a', ['b']), bundle('b', ['a']));
    expect(() => expandLoad(loaderMd('- @bakers-build/a'), cyclic)).toThrow(
      /a → b → a|cyclic/,
    );
  });

  it('throws when a bundle carries inline values under its own bullet', () => {
    expect(() =>
      expandLoad(
        loaderMd('- @bakers-build/essential-skills', '    validate: x'),
        byName,
      ),
    ).toThrow(/takes no inline values/);
  });

  it("carries a bundle's member value through to that member", () => {
    const withValues = map(
      bundle('essential-skills', ['qualify-ticket'], {
        'qualify-ticket': { tone: 'from bundle' },
      }),
      owner('qualify-ticket'),
    );
    const { values } = expandLoad(
      loaderMd('- @bakers-build/essential-skills'),
      withValues,
    );
    expect(values['qualify-ticket']).toEqual({ tone: 'from bundle' });
  });

  it('lets a WORKFLOW.md override beat the bundle value for the same key', () => {
    const withValues = map(
      bundle('essential-skills', ['qualify-ticket'], {
        'qualify-ticket': { tone: 'from bundle', only: 'bundle' },
      }),
      owner('qualify-ticket'),
    );
    const { values } = expandLoad(
      loaderMd(
        '- @bakers-build/essential-skills',
        '- @bakers-build/qualify-ticket',
        '    tone: from workflow',
      ),
      withValues,
    );
    expect(values['qualify-ticket']).toEqual({
      tone: 'from workflow',
      only: 'bundle',
    });
  });

  it('lets the outer bundle win over a nested one for the same key', () => {
    const nested = map(
      bundle('outer', ['inner'], { 'qualify-ticket': { tone: 'outer' } }),
      bundle('inner', ['qualify-ticket'], {
        'qualify-ticket': { tone: 'inner' },
      }),
      owner('qualify-ticket'),
    );
    const { values } = expandLoad(loaderMd('- @bakers-build/outer'), nested);
    expect(values['qualify-ticket']).toEqual({ tone: 'outer' });
  });
});

// ---------------------------------------------------------------------------
// Integration over the real bakers project config (AC 2, 6, 10, 11).
// ---------------------------------------------------------------------------

// Per-work-type step participation (BB-210). A step is work-typed when any work
// type participates in it. Docs bugs participate in diagnose with proportional checks.
const WORK_TYPE_STEPS: Record<string, readonly Triple['step'][]> = {
  code: ['spec', 'diagnose', 'coding', 'review'],
  docs: ['spec', 'diagnose', 'coding', 'review'],
};
// The union of all work-typed steps; every other step carries a null work_type.
const WORK_TYPED_STEPS = Array.from(
  new Set(Object.values(WORK_TYPE_STEPS).flat()),
);
// Claimable states per workflow, from web/.../bb_core.workflows.yml.
const WORKFLOW_STATES: Record<string, readonly string[]> = {
  bb_feature: ['qualification', 'spec', 'coding', 'review'],
  bb_bug: ['qualification', 'diagnose', 'coding', 'review'],
  bb_chore: ['qualification', 'spec', 'coding', 'review'],
  bb_deployment: ['pre_deployment', 'post_deployment'],
  bb_verification: ['verifying', 'summary'],
};

function projectTriples(): Triple[] {
  const triples: Triple[] = [];
  for (const [workflow, states] of Object.entries(WORKFLOW_STATES)) {
    for (const step of states) {
      if (WORK_TYPED_STEPS.includes(step as Triple['step'])) {
        // Only the work types whose participation includes this step, intersected
        // with the workflow's own states (the outer loop already enforces that).
        for (const [wt, steps] of Object.entries(WORK_TYPE_STEPS)) {
          if (steps.includes(step as Triple['step'])) {
            triples.push({
              work_type: wt,
              workflow,
              step: step as Triple['step'],
            });
          }
        }
      } else {
        triples.push({
          work_type: null,
          workflow,
          step: step as Triple['step'],
        });
      }
    }
  }
  return triples;
}

function loadSkillsFrom(dir: string) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) =>
      readSkillWhen(readInstructions(resolve(dir, d.name, 'SKILL.md'))),
    );
}

function loadAllSkills() {
  return loadSkillsFrom(SKILLS_DIR);
}

/**
 * One skill-set reference line, in either notation the section accepts. The captured group is
 * the file's basename, which lowercased is the set's NAME: the arrow notation carries no link
 * text, and editing a link's display text must not rename a `method:*` label (BB-431).
 */
const SKILL_SET_REFERENCE = /references\/([A-Za-z0-9._-]+)\.md/;

/** The listed sets, in listed order. */
function skillSetEntries(md: string): string[] {
  return [
    ...section(md, 'Skill set').matchAll(new RegExp(SKILL_SET_REFERENCE, 'g')),
  ].map((m) => m[1].toLowerCase());
}

/**
 * The same document with its first Skill set entry followed by a second (Matt), as a two-entry
 * bullet list. BB-444 made the repository ship the list form, so the real file no longer needs
 * synthesising; this helper survives only to pin the section-scoped rewrite property (it must
 * splice at the section's own offset, never document-wide — a reference line that one day also
 * appears in prose must not be rewritten by accident). It appends the NON-default set, so a
 * one-entry base reduced to the default (`superpowers`) becomes `superpowers, matt`.
 */
function withTwoSkillSets(md: string): string {
  const original = section(md, 'Skill set');
  const entry = original.split('\n').find((l) => SKILL_SET_REFERENCE.test(l));
  if (entry === undefined) {
    throw new Error('the `## Skill set` section links no reference');
  }
  const listed = original.replace(
    entry,
    `- ${entry.replace(/^\s*-\s+/, '')}\n- [Matt](.claude/skills/bakers-build/skills/method-context/references/matt.md)`,
  );
  const at = md.indexOf(original);
  return md.slice(0, at) + listed + md.slice(at + original.length);
}

/**
 * The same document reduced to its first Skill set entry — the one-entry no-op form. BB-444
 * adopted the list form as the shipped default, so "one entry changes nothing" is now synthesised
 * by reduction (the inverse of `withTwoSkillSets`) rather than read off the unedited file. Keeps
 * the first reference line, bullet stripped, and drops every other reference line; spliced at the
 * section's own offset for the same reason `withTwoSkillSets` documents.
 */
function withOneSkillSet(md: string): string {
  const original = section(md, 'Skill set');
  const refs = original.split('\n').filter((l) => SKILL_SET_REFERENCE.test(l));
  if (refs.length === 0) {
    throw new Error('the `## Skill set` section links no reference');
  }
  const kept = refs[0].replace(/^\s*-\s+/, '');
  const reduced = original
    .split('\n')
    .filter((l) => !SKILL_SET_REFERENCE.test(l) || l === refs[0])
    .map((l) => (l === refs[0] ? kept : l))
    .join('\n');
  const at = md.indexOf(original);
  return md.slice(0, at) + reduced + md.slice(at + original.length);
}

// Phase-0 golden: the effective loaded step owners, captured before the Essential-Skill
// rewire. `expandLoad(WORKFLOW.md, byName)` must still yield exactly these,
// in this order — proving the migration changed no effective capability (AC8, AC10).
const GOLDEN_OWNERS = [
  'qualify-ticket',
  'create-spec',
  'prepare-deployment',
  'post-deployment',
  'verify-on-environment',
  'summarize-verification',
  'ddev-drupal-bug',
  'ddev-drupal-feature',
  'docs-authoring',
] as const;

function byNameMap(skills: SkillContract[]) {
  return new Map(skills.map((s) => [s.name, s] as const));
}

describe('real bakers config resolves', () => {
  it('every project triple is matched by exactly one loaded skill with all inputs valued', () => {
    // the whole load step is one call: parse + expand + resolve -> validate
    const byName = byNameMap(loadAllSkills());
    const { skills, values } = expandLoad(read(WORKFLOW_MD), byName);
    expect(() => validateLoad(skills, values, projectTriples())).not.toThrow();
  });

  it('WORKFLOW.md loads the essential-skills bundle, not the six global bullets (AC4)', () => {
    const roots = Object.keys(parseStepValues(read(WORKFLOW_MD)));
    expect(roots).toContain('essential-skills');
    for (const global of [
      'qualify-ticket',
      'create-spec',
      'prepare-deployment',
      'post-deployment',
      'verify-on-environment',
      'summarize-verification',
    ]) {
      expect(roots).not.toContain(global);
    }
    // project-specific skills stay explicit bullets (AC5)
    for (const specific of [
      'ddev-drupal-bug',
      'ddev-drupal-feature',
      'docs-authoring',
    ]) {
      expect(roots).toContain(specific);
    }
  });

  it('essential-skills declares its members in its body, not its frontmatter (AC1)', () => {
    const md = readSkill('essential-skills');
    const [frontmatter] = md.split('\n---\n').slice(0, 1);
    expect(frontmatter).not.toMatch(/^loads:/m);
    expect(md).toMatch(/^##\s+Loaded skills\s*$/m);
  });

  it('essential-skills binds local HTTP(S) preview sharing to BB_TUNNEL and bakers ports', () => {
    const md = readSkill('essential-skills');
    expect(md).toMatch(/BB_TUNNEL/);
    expect(md).toMatch(/bakers ports list/);
    expect(md).toMatch(/bakers ports up/);
    expect(md).toMatch(/Unknown policy or failure[\s\S]*local-only/);
    expect(md).toMatch(/ephemeral tunnel hostnames/);
  });

  it('essential-skills is a bundle loading exactly the six globals in documented order (AC1, AC3)', () => {
    const c = readSkillWhen(readSkill('essential-skills'));
    expect(c.when).toBeUndefined();
    expect(c.loads).toEqual([
      'qualify-ticket',
      'create-spec',
      'prepare-deployment',
      'post-deployment',
      'verify-on-environment',
      'summarize-verification',
    ]);
  });

  // Both no-drift guards below compare against GOLDEN_OWNERS / the shipped OWNERS, so they filter
  // the expansion to `when`-bearing skills. `expandLoad` also emits **helper** leaves — a skill with
  // no `when`, loaded for its inputs rather than for a step. A helper is invisible to `validateLoad`'s
  // triple matching by construction, so including it here would make these assertions fail for a
  // reason they do not describe. bakers's own WORKFLOW.md loads no helper (BB-246 keeps the origin
  // label chain in the skill's own default so the loader stays minimal), so the helper path is
  // covered by its own test below, over a synthetic WORKFLOW.md.
  const ownersOf = (skills: SkillContract[]) =>
    skills.filter((s) => s.when !== undefined).map((s) => s.name);

  it('expanding WORKFLOW.md yields exactly the golden owners in order (AC8, AC10)', () => {
    const byName = byNameMap(loadAllSkills());
    const expanded = expandLoad(read(WORKFLOW_MD), byName);
    expect(ownersOf(expanded.skills)).toEqual([...GOLDEN_OWNERS]);
  });

  it('the expanded set equals every step owner shipped — no drift (AC10)', () => {
    const all = loadAllSkills();
    const byName = byNameMap(all);
    const expanded = expandLoad(read(WORKFLOW_MD), byName);
    const shippedOwners = all
      .filter((s) => s.when !== undefined)
      .map((s) => s.name)
      .sort();
    expect(ownersOf(expanded.skills).sort()).toEqual(shippedOwners);
  });

  // BB-246: a project overrides the origin label chain by adding a bullet for a skill that owns NO
  // step, purely to give its input a load site. bakers's own WORKFLOW.md deliberately carries no such
  // bullet (the chain is the skill's default), so this drives the override path over a synthetic
  // WORKFLOW.md — otherwise the one mechanism a consumer actually edits would go untested.
  //
  // BB-436: this fixture used to write the override as the bare `origin_labels`, a key
  // `publish-origin-status` does not declare (it declares `origin_labels.data`) — so the
  // override reached nothing and the skill ran on its default, which is the exact defect
  // BB-436 fixes. Renamed to the declared key, per "rename it, don't delete it": the
  // bullet's whole point is to give that input a load site, and the old key gave it none.
  it('a loaded helper leaf resolves its inline value without becoming an owner (BB-246)', () => {
    const byName = byNameMap(loadAllSkills());
    const synthetic = [
      '## Loaded skills',
      '',
      '- @bakers-build/essential-skills',
      '- @bakers-build/ddev-drupal-bug',
      '- @bakers-build/ddev-drupal-feature',
      '- @bakers-build/docs-authoring',
      '- @bakers-build/publish-origin-status',
      '    origin_labels.data: |',
      '      coding: in Arbeit',
      '      done: fertig',
      '',
    ].join('\n');
    const expanded = expandLoad(synthetic, byName);

    const helper = expanded.skills.find(
      (s) => s.name === 'publish-origin-status',
    );
    expect(helper).toBeDefined();
    // A helper owns no step, so it can never match a triple or collide with an owner…
    expect(helper?.when).toBeUndefined();
    expect(ownersOf(expanded.skills)).not.toContain('publish-origin-status');
    // …the owner set is unaffected by its presence…
    expect(ownersOf(expanded.skills)).toEqual([...GOLDEN_OWNERS]);
    // …and the override resolves, which is the whole point of the bullet.
    expect(
      expanded.values['publish-origin-status']?.['origin_labels.data'],
    ).toBe('coding: in Arbeit\ndone: fertig\n');
    // A helper's presence must not make validateLoad reject the load.
    expect(() =>
      validateLoad(expanded.skills, expanded.values, projectTriples()),
    ).not.toThrow();
  });

  it('the shipped origin label chain is the skill default, not a WORKFLOW.md bullet (BB-246)', () => {
    // Keeping WORKFLOW.md minimal is the point: a project touches it only to deviate.
    expect(parseStepValues(read(WORKFLOW_MD))).not.toHaveProperty(
      'publish-origin-status',
    );
    const skill = readSkillWhen(readSkill('publish-origin-status'));
    const chain = skill.inputs.find(
      (i) => i.key === 'origin_labels.data',
    )?.default;
    expect(chain).toBeTruthy();
    for (const entry of [
      'qualification: doing',
      'spec: doing',
      'coding: doing',
      'review: doing',
      'done: review',
    ]) {
      expect(chain).toContain(entry);
    }
  });

  it('per-workflow effective set is unchanged for every workflow (AC10 parity)', () => {
    const byName = byNameMap(loadAllSkills());
    const expanded = expandLoad(read(WORKFLOW_MD), byName);
    const owners = expanded.skills.filter((s) => s.when !== undefined);
    const forWorkflow = (wf: string) =>
      owners
        .filter((s) => {
          const w = s.when?.workflow;
          return w === '*' || w === undefined || w.includes(wf);
        })
        .map((s) => s.name)
        .sort();
    // Golden per-workflow sets (the pre-rewire effective capability per workflow).
    expect(forWorkflow('bb_feature')).toEqual(
      [
        'create-spec',
        'ddev-drupal-feature',
        'docs-authoring',
        'qualify-ticket',
      ].sort(),
    );
    expect(forWorkflow('bb_bug')).toEqual(
      ['ddev-drupal-bug', 'docs-authoring', 'qualify-ticket'].sort(),
    );
    expect(forWorkflow('bb_chore')).toEqual(
      [
        'create-spec',
        'ddev-drupal-feature',
        'docs-authoring',
        'qualify-ticket',
      ].sort(),
    );
    expect(forWorkflow('bb_deployment')).toEqual(
      ['post-deployment', 'prepare-deployment'].sort(),
    );
    expect(forWorkflow('bb_verification')).toEqual(
      ['summarize-verification', 'verify-on-environment'].sort(),
    );
  });

  it('validateLoad over the expanded WORKFLOW.md set stays green (AC11)', () => {
    const byName = byNameMap(loadAllSkills());
    const expanded = expandLoad(read(WORKFLOW_MD), byName);
    expect(() =>
      validateLoad(expanded.skills, expanded.values, projectTriples()),
    ).not.toThrow();
  });

  // Foreign owners extend project coverage without requiring installed plugins.
  const FOREIGN_OWNERS = [
    ['artifact-design', 'artifact-design'],
    ['config-sync', 'config-sync'],
  ] as const;

  const foreignFixture = (name: string, workType: string) =>
    [
      '---',
      `name: ${name}`,
      `description: stand-in for the ${name} external step owner.`,
      'when:',
      `  work_type: ${workType}`,
      '  workflow: [bb_feature, bb_bug, bb_chore]',
      '  step: [diagnose, spec, coding, review]',
      'inputs:',
      '  validate:',
      '    description: command that validates the external artifact',
      '    default: "@example/design-verify"',
      '---',
      '',
      `# ${name}`,
    ].join('\n');

  /** Load foreign owners alongside the project’s own skills. */
  const withForeignBullets = (): string => {
    const lines = read(WORKFLOW_MD).split('\n');
    const start = lines.findIndex((l) => /^##\s+Loaded skills\s*$/.test(l));
    expect(
      start,
      'WORKFLOW.md must carry a `## Loaded skills` section',
    ).toBeGreaterThanOrEqual(0);
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (/^##\s+/.test(lines[i] ?? '')) {
        end = i;
        break;
      }
    }
    return [
      ...lines.slice(0, end),
      ...FOREIGN_OWNERS.map(([name]) => `- @example/${name}`),
      '',
      ...lines.slice(end),
    ].join('\n');
  };

  const tripleKeys = (triples: Triple[]) =>
    triples.map((t) => JSON.stringify([t.work_type, t.workflow, t.step]));

  it('foreign work types validate once their owners load', () => {
    const byName = byNameMap(loadAllSkills());

    // Precondition, and the guard on `deriveProjectTriples` itself: over the real
    // WORKFLOW.md the derivation must reproduce the hand-written table above,
    // exactly — otherwise the +18 below measures the derivation, not the fix.
    const base = expandLoad(read(WORKFLOW_MD), byName);
    expect(tripleKeys(deriveProjectTriples(base.skills)).sort()).toEqual(
      tripleKeys(projectTriples()).sort(),
    );

    for (const [name, workType] of FOREIGN_OWNERS) {
      byName.set(name, readSkillWhen(foreignFixture(name, workType)));
    }
    const expanded = expandLoad(withForeignBullets(), byName);

    // Both foreign bullets resolve as leaf owners (the defect: they resolved to
    // nothing, leaving the two work types uncovered no matter how they were written).
    expect(ownersOf(expanded.skills).sort()).toEqual(
      [...GOLDEN_OWNERS, ...FOREIGN_OWNERS.map(([n]) => n)].sort(),
    );

    // Each foreign work type adds nine reachable triples.
    const triples = deriveProjectTriples(expanded.skills);
    const added = triples.filter(
      (t) => t.work_type === 'artifact-design' || t.work_type === 'config-sync',
    );
    expect(added).toHaveLength(18);
    expect(triples).toHaveLength(projectTriples().length + 18);

    // Zero gaps, zero collisions, every override resolved.
    expect(() =>
      validateLoad(expanded.skills, expanded.values, triples),
    ).not.toThrow();
  });

  // BB-436 shipped a third case here, `project-specific overrides still resolve after
  // expansion (AC5)`, asserting `values['ddev-drupal-bug']['validate.command']` and
  // `values['ddev-drupal-feature']['provision.command']`. It is deliberately NOT carried into
  // this branch: BB-424 removed those `inputs` from both step owners and the matching
  // overrides from `WORKFLOW.md`, which now binds project specifics through its `Skills` and
  // `Checks` tables instead. Keeping the case would assert a mechanism this branch retired, so
  // it would fail for being right about develop rather than about here. What it guarded —
  // that an override resolves after expansion — is covered by `validateLoad`'s own
  // every-declared-input-has-a-value rule, exercised by the AC11 case above.

  // BB-444 made the repository ship the list form itself, so this case reads the real two-entry
  // section directly and synthesises the one-entry no-op by reduction (the inverse of the old
  // synthesise-the-list approach).
  //
  // The expansion equality is DOCUMENTATION, not proof: `expandLoad` parses `## Loaded skills`
  // and never reads `## Skill set` at all, so it could not diverge for a skill-set reason. What
  // the case genuinely pins is the entries assertion — that the shipped section parses to every
  // listed set name, in listed order (superpowers first, the project default).
  it('loads lifecycle owners independently of the selected skill set, list form included', () => {
    const wf = read(WORKFLOW_MD);
    expect(skillSetEntries(wf)).toEqual(['superpowers', 'matt']);
    const oneEntry = withOneSkillSet(wf);
    expect(skillSetEntries(oneEntry)).toEqual(['superpowers']);

    const byName = byNameMap(loadAllSkills());
    const original = expandLoad(wf, byName);
    for (const variant of [oneEntry, withTwoSkillSets(oneEntry)]) {
      const expanded = expandLoad(variant, byName);
      expect(expanded).toEqual(original);
      expect(() =>
        validateLoad(expanded.skills, expanded.values, projectTriples()),
      ).not.toThrow();
    }
    expect(wf).not.toMatch(/^## State:/m);
  });

  it('WORKFLOW.template.md is a pure loader too', () => {
    const tpl = read(TEMPLATE_MD);
    expect(tpl).toMatch(/## Loaded skills/);
    expect(tpl).not.toMatch(/^## State:/m);
    expect(() => parseStepValues(tpl)).not.toThrow();
  });
});

describe('skill-text contract (AC 1, 3, 4, 5, 9)', () => {
  it('workflow-step contract skill documents the model', () => {
    const md = readSkill('workflow-step');
    expect(md).toMatch(/work_type/);
    expect(md).toMatch(/workflow/);
    expect(md).toMatch(/\bstep\b/);
    expect(md).toMatch(/exactly one/i);
    // per-skill inline values, not a global block
    expect(md).toMatch(/inline under/i);
  });

  it('the concrete work-type skills ship with the expected when', () => {
    const bug = readSkillWhen(readSkill('ddev-drupal-bug'));
    expect(bug.when?.work_type).toEqual(['code']);
    expect(bug.when?.workflow).toEqual(['bb_bug']);
    expect(bug.when?.step).toEqual(['diagnose', 'coding', 'review']);

    const feat = readSkillWhen(readSkill('ddev-drupal-feature'));
    expect(feat.when?.work_type).toEqual(['code']);
    expect(feat.when?.workflow).toEqual(['bb_feature', 'bb_chore']);
    expect(feat.when?.step).toEqual(['coding', 'review']);

    const docs = readSkillWhen(readSkill('docs-authoring'));
    expect(docs.when?.work_type).toEqual(['docs']);
    expect(docs.when?.workflow).toEqual(['bb_feature', 'bb_bug', 'bb_chore']);
    expect(docs.when?.step).toEqual(['spec', 'diagnose', 'coding', 'review']);
  });

  it('the bug skill is prose per owned step, naming its gates and transition', () => {
    const md = readSkill('ddev-drupal-bug');
    expect(md).toMatch(/^## diagnose/m);
    expect(md).toMatch(/^## coding/m);
    expect(md).toMatch(/^## review/m);
    expect(md).toMatch(/RED/);
    expect(md).toMatch(/GREEN/);
    expect(md).toMatch(/@bakers-build\/workflow-step/);
    expect(readSkill('workflow-step')).toMatch(
      /@bakers-build\/transition-ticket/,
    );
    expect(md).not.toMatch(/^phases:/m);
  });

  it('the feature skill owns only coding + review (no diagnose)', () => {
    const md = readSkill('ddev-drupal-feature');
    expect(md).toMatch(/^## coding/m);
    expect(md).toMatch(/^## review/m);
    expect(md).not.toMatch(/^## diagnose/m);
  });

  it('the non-work-typed state skills declare when with work_type omitted + routing prose', () => {
    // spec is work-typed (create-spec owns work:code; docs-authoring owns work:docs), so it is
    // not in this list; qualification, deployment, and verification stay work-type-agnostic.
    const states: Array<[string, string]> = [
      ['qualify-ticket', 'qualification'],
      ['prepare-deployment', 'pre_deployment'],
      ['post-deployment', 'post_deployment'],
      ['verify-on-environment', 'verifying'],
      ['summarize-verification', 'summary'],
    ];
    for (const [name, step] of states) {
      const c = readSkillWhen(readSkill(name));
      expect(c.when, `${name} must declare when`).toBeDefined();
      expect(c.when?.work_type, `${name} must omit work_type`).toBeUndefined();
      expect(c.when?.step).toContain(step);
      expect(readSkill(name)).toMatch(/@bakers-build\/transition-ticket/);
    }
  });

  it('create-spec owns the code spec step; docs-authoring owns its own', () => {
    const spec = readSkillWhen(readSkill('create-spec'));
    expect(spec.when?.work_type).toEqual(['code']);
    expect(spec.when?.step).toContain('spec');
    const docs = readSkillWhen(readSkill('docs-authoring'));
    expect(docs.when?.work_type).toEqual(['docs']);
    expect(docs.when?.step).toContain('spec');
  });

  // BB-381 AC-5 — design/plan writers publish typed `spec` + `plan` (+ `test`)
  // through `@bakers-build/publish-comment`. Diagnose stays `debug_diagnose` + `test`.
  it('BB-381: create-spec and docs-authoring instruct plan + publish-comment', () => {
    for (const name of ['create-spec', 'docs-authoring'] as const) {
      const md = readSkill(name);
      expect(md, `${name} names @bakers-build/publish-comment`).toMatch(
        /@bakers-build\/publish-comment/,
      );
      expect(md, `${name} publishes typed plan (not only spec + test)`).toMatch(
        /`plan`/,
      );
      expect(md, `${name} still publishes typed spec`).toMatch(/`spec`/);
      expect(md, `${name} still publishes the test handoff`).toMatch(/`test`/);
    }
    const diagnose = readSkill('diagnose-ticket');
    expect(diagnose).toMatch(/debug_diagnose/);
    expect(diagnose).not.toMatch(
      /@bakers-build\/publish-comment[\s\S]{0,120}`plan`|`plan`[\s\S]{0,120}@bakers-build\/publish-comment/,
    );
  });

  // BB-381 AC-5 — qualification / acceptance handoffs keep their own types.
  // They must go through `@bakers-build/publish-comment` and must NOT reuse `spec`
  // (design) or `plan` (implementation plan) for those comments.
  it('BB-381: qualify/create-ticket/acceptance publish typed qualification and acceptance', () => {
    const md = readSkill('qualify-ticket');
    expect(md).toMatch(
      /Publish one complete `qualification` handoff through\s+`@bakers-build\/publish-comment`/,
    );
    expect(md).toMatch(/@bakers-build\/acceptance/);
    expect(md).toMatch(/@bakers-build\/run-outtake` once/);
  });

  it('docs-authoring is self-contained: owns work:docs spec + coding + review with a non-runtime, no-provision contract', () => {
    const c = readSkillWhen(readSkill('docs-authoring'));
    expect(c.when?.work_type).toEqual(['docs']);
    expect(c.when?.workflow).toEqual(['bb_feature', 'bb_bug', 'bb_chore']);
    expect(c.when?.step).toEqual(['spec', 'diagnose', 'coding', 'review']);
    expect(c.inputs).toEqual([]);
    // the prose owns spec + coding + review (no diagnose), routes via transition-ticket,
    // and invokes no runtime ceremony: it never calls @bakers-build/provision-ddev nor
    // @bakers-build/scenario (docs authors no scenario and provisions no environment).
    const md = readSkill('docs-authoring');
    expect(md).toMatch(/^## spec/m);
    expect(md).toMatch(/^## coding/m);
    expect(md).toMatch(/^## review/m);
    expect(md).toMatch(/^## diagnose/m);
    expect(md).toMatch(/@bakers-build\/transition-ticket/);
    expect(md).not.toMatch(/@bakers-build\/provision-ddev/);
    expect(md).not.toMatch(/@bakers-build\/scenario/);
  });

  it('the loaders + README + presentation carry docs-authoring / work:docs', () => {
    expect(read(WORKFLOW_MD)).toContain('@bakers-build/docs-authoring');
    expect(readSkill('docs-authoring')).toContain('work:docs');
    for (const name of ['run-intake', 'run-outtake']) {
      expect(readSkill(name)).not.toMatch(/`work:(code|docs)`/);
    }
    expect(readSkill('run-outtake')).toContain('aggregated');
    expect(readSkill('run-outtake')).toContain('deliverables');
  });

  it('README + template carry the reversed routing invariant, not the old one', () => {
    const readme = read(README_MD);
    const template = read(TEMPLATE_MD);
    expect(readme).not.toMatch(/never chooses its successor/);
    expect(readme).toMatch(/pure loader/i);
    expect(template).toContain('step-owning skills choose transitions');
  });
});

// Work-type terms are declared by the owning skills and ensured at runtime by
// qualify-ticket, so a work type ships with its skill and never depends on the
// seed. The classification rule for each type is its term description.
describe('work-type terms are skill-declared + qualify-ensured (dynamic registry)', () => {
  // The frontmatter's `work_type_term` name, or undefined when none is declared.
  const termName = (skill: string): string | undefined =>
    readSkill(skill).match(
      /work_type_term:\s*\n\s*name:\s*["']([^"']+)["']/,
    )?.[1];

  // Every step-owning skill that owns a work type, paired with the term it must declare.
  const OWNERS: Record<string, string> = {
    'ddev-drupal-bug': 'work:code',
    'ddev-drupal-feature': 'work:code',
    'create-spec': 'work:code',
    'docs-authoring': 'work:docs',
  };

  it('every work-type-owning skill declares its work_type_term', () => {
    for (const [skill, name] of Object.entries(OWNERS)) {
      expect(termName(skill), `${skill} must declare work_type_term`).toBe(
        name,
      );
    }
  });

  it('declarations of the same work type agree (no drift across skills)', () => {
    // group skills by declared term name; each group must be internally identical
    const descOf = (skill: string) =>
      readSkill(skill).match(
        /work_type_term:\s*\n\s*name:\s*["'][^"']+["']\s*\n\s*description:\s*["']([^"']+)["']/,
      )?.[1];
    const byName: Record<string, Set<string>> = {};
    for (const [skill, name] of Object.entries(OWNERS)) {
      const set = byName[name] ?? new Set<string>();
      set.add(descOf(skill) ?? '');
      byName[name] = set;
    }
    for (const [name, descs] of Object.entries(byName)) {
      expect(descs.size, `conflicting descriptions for ${name}`).toBe(1);
      expect([...descs][0]).toBeTruthy();
    }
  });

  it('the seeded work:docs term matches the skill declaration', () => {
    // AC1: the seed and the skill declaration agree, so the runtime ensure is a no-op here.
    const seed = read(
      resolve(
        REPO_ROOT,
        'recipes/bb_seed/content/bb_term/db1a0000-0000-4000-8000-000000000013.yml',
      ),
    );
    expect(seed).toMatch(/name:\s*\n\s*-\s*\n\s*value:\s*["']work:docs["']/);
  });

  it('qualify-ticket classifies dynamically and ensures terms — no hardcoded type list', () => {
    const md = readSkill('qualify-ticket');
    // taxonomy-driven, self-provisioning
    expect(md).toMatch(/work_type_term/);
    expect(md).toMatch(/--bundle bb_labels/);
    expect(md).toMatch(/create missing terms/i);
    expect(md).toMatch(/taxonomy-driven|not hardcoded/i);
    // the old hardcoded "work:docs vs work:code" heading is gone
    expect(md).not.toMatch(/`work:docs` vs `work:code`/);
  });
});

// ---------------------------------------------------------------------------
// BB-209 — workflow-hardening contract (AC 1-9, D7, D8).
// These behaviors are skill-prose (agent-executed), so per the spec's R2 they
// are asserted over stable structural markers, not free text. MR-link
// resolution and the gitlab merge are agent/gitlab-side (R3: no credentials in
// a test), so they are covered here structurally rather than by a live-gitlab
// integration test.
// ---------------------------------------------------------------------------

/** Slice a `## <step>` section out of a skill body (up to the next `## `). */
function codingInstructions(owner: string): string {
  const coding = stepSection(readSkill(owner), 'coding');
  expect(coding).toContain('`@bakers-build/method-context` › *Coding flow*');
  return `${coding}\n${section(readSkill('method-context'), 'Coding flow')}`;
}

function stepSection(md: string, step: string): string {
  const start = md.search(new RegExp(`^## ${step}\\b`, 'm'));
  if (start < 0) throw new Error(`no '## ${step}' section`);
  const next = md.indexOf('\n## ', start + 1);
  return next < 0 ? md.slice(start) : md.slice(start, next);
}

describe('project browser checks', () => {
  it('keeps browser E2E in WORKFLOW.md and outside skill-set selection', () => {
    const project = section(read(WORKFLOW_MD), 'Checks');
    expect(project).toContain('cd tests/playwright');
    expect(project).toContain('Browser E2E uses Playwright, never PHPUnit');
    for (const name of ['ddev-drupal-bug', 'ddev-drupal-feature']) {
      expect(readSkillWhen(readSkill(name)).inputs).toEqual([]);
    }
  });
});

describe('BB-209 MR-link persistence + merge gate (AC 6, 7, 8, 9)', () => {
  it('run-intake + run-outtake + review-ticket resolve the same MR link at review', () => {
    const md = readSkill('run-outtake');
    expect(md).toMatch(/Reuse the resolved MR from coding/);
    expect(md).toMatch(/missing MR is a run failure/);
  });

  it('the merge-mr capability skill gates the merge and never writes state', () => {
    const md = readSkill('merge-mr');
    expect(md).toMatch(/glab mr merge/);
    expect(md).toMatch(/--squash/);
    expect(md).toMatch(/pipeline green/i);
    expect(md).toMatch(/conflict/i);
    expect(md).toMatch(/writes no ticket state/i);
  });

  it('the merge/OK->done rule lives once in method-context Review flow; owners reference it', () => {
    // BB-444 single-sourced the review orchestration. The merge gate, OK->done and
    // Not OK->coding now live in method-context › Review flow; the owners point at it.
    const flow = section(readSkill('method-context'), 'Review flow');
    expect(flow).toMatch(/@bakers-build\/merge-mr/);
    expect(flow).toMatch(/only after a verified merge/i);
    expect(flow).toMatch(/Not OK/);
    expect(flow).toMatch(/coding/);
    expect(flow).toMatch(/explicit merge authorization/);
    for (const s of [
      'ddev-drupal-feature',
      'ddev-drupal-bug',
      'docs-authoring',
    ]) {
      const review = stepSection(readSkill(s), 'review');
      expect(review, `${s} must reference the Review flow`).toMatch(
        /@bakers-build\/method-context` › \*Review flow\*/,
      );
      // and must NOT restate the merge gate itself
      expect(review, `${s} must not restate the merge gate`).not.toMatch(
        /@bakers-build\/merge-mr/,
      );
    }
  });
});

describe('BB-209 outtake visibility: Walkthrough vs Gherkin (D7, D8)', () => {
  it('introduces manual review with usable resources, user and expected results', () => {
    const md = readSkill('run-outtake');
    expect(md).toMatch(/intended account\/role and environment/);
    expect(md).toMatch(/all related resources/);
    expect(md).toMatch(/runnable CLI commands with working directory\/access/);
    expect(md).toMatch(/actions with expected observations/);
    expect(md).toMatch(/Preserve every supplied actor\/path/);
    expect(md).toMatch(/Each link gets 🔗/);
    expect(md).toMatch(/blank lines around it/);
    expect(md).toMatch(
      /One-time login URLs are explicitly allowed in terminal and ticket/,
    );
    expect(md).toMatch(/Preserve the issued URL\s+unchanged/);
    expect(md).toMatch(/label user, role and environment/);
    expect(md).toMatch(/Never substitute the default admin/);
    expect(md).toMatch(/caller renews\s+expired links/);
  });

  it('spec and diagnose link the plan for review', () => {
    const md = readSkill('run-outtake');
    expect(md).toMatch(/all related resources/);
    expect(md).toMatch(/Distinguish delivered\s+work from proposals/);
  });

  it('the "Testanleitung" label is not shipped anywhere', () => {
    for (const s of [
      'scenario',
      'run-outtake',
      'ddev-drupal-feature',
      'ddev-drupal-bug',
    ]) {
      expect(readSkill(s)).not.toMatch(/Testanleitung/);
    }
    // the browser helper is now a Walkthrough, not an abstract scenario artifact
    expect(readSkill('scenario')).toMatch(/browser paths/i);
  });
});

describe('BB-290 workflow evidence contract', () => {
  it('creation qualifies and routes to spec/diagnose without starting phase work', () => {
    const md = readSkill('create-ticket');
    expect(md).toMatch(/Creation intake is the qualification confirmation/);
    expect(md).toMatch(/Publish exactly `qualification`/);
    expect(md).toMatch(/feature\/chore → `spec`, bug → `diagnose`/);
    expect(md).toMatch(/Verify readback and STOP/);
    expect(md).toMatch(/Create no phase artifacts or implementation unless/);
  });

  it('qualification is acceptance-first and remains the explicit routing owner', () => {
    const md = readSkill('qualify-ticket');
    expect(md).toMatch(/acceptance.*first|acceptance criteria.*before/i);
    expect(md).toMatch(/bullet/i);
    expect(md.indexOf('acceptance_criteria')).toBeLessThan(
      md.indexOf('ticket_type'),
    );
    expect(md).toContain('@bakers-build/transition-ticket');
  });

  it('spec and diagnosis use the shared ticket verification contract', () => {
    const md = readSkill('method-context');
    expect(md).toMatch(/Project checks and Functional validation/);
    expect(md).toMatch(/`rationale`/);
    expect(md).toMatch(/`command_or_steps`/);
    expect(md).toMatch(/`expected`/);
    expect(md).toMatch(/`ac_ids`/);
    expect(md).toMatch(/Missing section is unresolved/i);
  });

  it('browser plans record the CLI walk, before/after screenshots, and the transient root', () => {
    // The convention has ONE owner. It used to be spelled out in six files — four
    // asserted here plus run-outtake and scenario — which is how a path convention
    // ends up written slightly differently in each and maintained in none. The
    // evidence shape is `verify-playwright-cli`'s; everyone else names the walk and
    // hands the resulting paths on.
    //
    // BB-371: the path it owns is gitignored and transient, so what it reports is
    // the triad (command + observed result + commit) rather than a link. The old
    // `issues/<ticket>/…/attempt-<n>/img/` path was itself gitignored, which is why
    // asserting that a path is *named* is not enough — it must be the ignored root
    // the ticket never links to.
    const owner = readSkill('verify-playwright-cli');
    expect(owner).toMatch(/`playwright\/` tool directory/);
    expect(owner).toMatch(/@bakers-build\/essential-skills/);
    expect(owner).not.toMatch(/attempt-<n>|e2e-testing/);
    expect(owner).toMatch(/before/);
    expect(owner).toMatch(/after/);
    expect(readSkill('essential-skills')).toMatch(/observed result/i);
    expect(readSkill('essential-skills')).toMatch(/commit/i);

    for (const skill of ['scenario', 'verify-tests']) {
      expect(readSkill(skill)).toContain('@bakers-build/verify-playwright-cli');
      expect(readSkill(skill)).not.toMatch(/assets-ai/);
    }
  });

  it('the transient root is named only by the skills that own or create it', () => {
    // BB-371: the retired path was spelled out in six files and maintained in
    // none (that is finding F2, and it is why two incompatible shapes grew). Each
    // name below is a distinct job, and a skill that merely mentions the root in
    // passing belongs to none of them — it points at the bundle instead.
    const named = readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((name) => readSkill(name).includes('assets-ai'))
      .sort();
    expect(named).toEqual([
      'essential-skills', // defines the shape
      'init-project', // writes the ignore entry in a fresh repository
      'upgrade-project', // migrates an existing repository's entry and archive
    ]);
  });

  it('offers stable icon headings that other skills can extend', () => {
    const visible = section(readSkill('run-outtake'), 'Visible summary');
    expect(
      [...visible.matchAll(/^### (.+)$/gm)].map((match) => match[1]),
    ).toEqual([
      '🎯 Outcome',
      '📖 Spec digest',
      '✅ Success',
      '⚠️ Problems',
      '🧪 Manual review',
      '➡️ Next action',
    ]);
    expect(visible).toMatch(/extend their matching paragraphs/);
    expect(visible).toMatch(/stable headings/);
  });

  it('translates the complete spec, coding, and review summary into English', () => {
    const md = readSkill('run-outtake');
    expect(md).toMatch(/spec, coding,? and review/i);
    expect(md).toMatch(
      /translate[\s\S]{0,120}(?:incoming|source|ticket)[\s\S]{0,120}English|(?:incoming|source|ticket)[\s\S]{0,120}translate[\s\S]{0,120}English/i,
    );
  });

  it('explains intention before the result and ends with one action', () => {
    const md = readSkill('run-outtake');
    expect(md).toMatch(/Explain what you did, what worked, what failed/);
    expect(md).toMatch(/Success stays brief/);
    expect(md).toMatch(/what you did and why/);
    expect(md).toMatch(/End with one concrete action or decision/);
  });

  it('coding requires applicable evidence before reporting success', () => {
    for (const name of [
      'ddev-drupal-feature',
      'ddev-drupal-bug',
      'docs-authoring',
    ]) {
      const coding = codingInstructions(name);
      expect(coding).toContain('@bakers-build/verify-tests');
      expect(coding).toMatch(/every applicable|all.*applicable/);
      expect(coding).toContain('GREEN');
    }
  });

  it('captures check output in the transient root and publishes only durable links', () => {
    const verify = readSkill('verify-tests');
    expect(verify).toContain('durable evidence and transient-root rules');
    expect(readSkill('essential-skills')).toContain(
      'assets-ai/<bakers.build-nnn>/',
    );
    const outtake = readSkill('run-outtake');
    expect(outtake).toMatch(/Ticket evidence uses verified absolute/);
    expect(outtake).toMatch(/local artifacts remain terminal conveniences/);
    expect(outtake).toMatch(/Complete evidence stays in the typed handoff/);
    expect(outtake).toMatch(/Created tests and checks not run are not passes/);
  });

  it('review preserves evidence scope and reruns for a concrete reason', () => {
    const md = readSkill('review-ticket');
    expect(md).toMatch(
      /Rerun only for new changes, failures, missing evidence/,
    );
    expect(md).toMatch(/explicit request/);
    expect(md).toMatch(/record why/i);
    expect(md).toMatch(/Preserve the original\s+revision and scope/);
  });

  it('verify-tests reports observed results per check with AC mappings', () => {
    const md = readSkill('verify-tests');
    expect(md).toMatch(/one `results` record per check/);
    expect(md).toMatch(/actual actor, environment and immutable revision/);
    expect(md).toMatch(/functional\s+checks must identify the criteria/);
    expect(md).toMatch(/No observed output means no passed result/);
    expect(md).toMatch(/including browser suites such as Playwright/);
  });

  it('verify-playwright-cli owns browser execution and the transient artifacts', () => {
    const md = readSkill('verify-playwright-cli');
    expect(md).toMatch(/playwright-cli/);
    expect(md).toMatch(/screenshots/);
    expect(md).toMatch(/transient-root rules/);
    expect(md).toMatch(/permanent/i);
    expect(md).toMatch(/@bakers-build\/verify-tests/);
  });
});

// ---------------------------------------------------------------------------
// BB-262 — the standards reference is rolled back into WORKFLOW.md.
//
// BB-242 introduced CONVENTIONS.md, a `standards` input on four step owners
// and a `@bakers-build/workflow-step` dispatch clause. All three are gone; the content
// now lives in WORKFLOW.md's own `## Skills` / `## Standards` sections.
// These are NEGATIVE guards: they exist so the mechanism cannot creep back, and
// so the folded-in bullets cannot drift into the loaded-skills range.
// ---------------------------------------------------------------------------

/** The four step owners that used to declare a `standards` input (BB-242). */
const FORMER_STANDARDS_OWNERS = [
  'create-spec',
  'ddev-drupal-bug',
  'ddev-drupal-feature',
  'docs-authoring',
] as const;

const everySkillMd = () =>
  readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => [d.name, readSkill(d.name)] as const);

describe('BB-262 the conventions reference is folded into WORKFLOW.md', () => {
  it('neither CONVENTIONS.md nor its template ships any more (AC 1)', () => {
    expect(existsSync(CONVENTIONS_MD), 'CONVENTIONS.md must be gone').toBe(
      false,
    );
    expect(
      existsSync(CONVENTIONS_TEMPLATE_MD),
      'CONVENTIONS.template.md must be gone',
    ).toBe(false);
  });

  it('no loader, template, README or skill names CONVENTIONS (AC 2)', () => {
    const sources: Array<[string, string]> = [
      ['WORKFLOW.md', read(WORKFLOW_MD)],
      ['WORKFLOW.template.md', read(TEMPLATE_MD)],
      ['README.md', read(README_MD)],
      ...everySkillMd().map(([name, md]): [string, string] => [
        `${name}/SKILL.md`,
        md,
      ]),
    ];
    for (const [label, md] of sources) {
      expect(md, `${label} must not name CONVENTIONS`).not.toMatch(
        /CONVENTIONS/,
      );
    }
  });

  it('the by-name dispatch clause is gone from workflow-step and both dispatchers (AC 4)', () => {
    expect(readSkill('workflow-step')).not.toMatch(
      /^## Standards reach a subagent only by name$/m,
    );
    for (const skill of [
      'workflow-step',
      'review-ticket',
      ...FORMER_STANDARDS_OWNERS,
    ]) {
      expect(
        readSkill(skill),
        `${skill} must not cite the removed clause`,
      ).not.toMatch(/Standards reach a subagent/);
    }
  });

  it('WORKFLOW.template.md describes the new model and still parses (AC 6)', () => {
    const tpl = read(TEMPLATE_MD);
    expect(tpl).toMatch(/^## Skills$/m);
    expect(tpl).toMatch(/^## Standards$/m);
    expect(tpl).not.toMatch(/CONVENTIONS/);
    expect(tpl).not.toMatch(/standards.*input/i);
    expect(tpl).not.toMatch(/^## State:/m);
    expect(() => parseStepValues(tpl)).not.toThrow();
  });
});
// ---------------------------------------------------------------------------
// BB-280 — a required skill dependency is DELIVERED, binding, and fails closed.
//
// Three separate places, deliberately:
//   1. WHICH skills — a `<role>.prompt` value (a frontmatter default, or a
//      WORKFLOW.md override). A skill body never names another skill.
//   2. THE RULE — written ONCE, in WORKFLOW.md › Required skills. Not in
//      `@bakers-build/workflow-step`: that document is never injected, so a rule placed
//      there would share the delivery gap it exists to close. WORKFLOW.md *is*
//      read on every run, because the run prompt tells the agent to read it.
//   3. THE POINTER — one line per site, so the rule reaches the actor without
//      being restated seven times (which is what made it drift-prone).
// ---------------------------------------------------------------------------

/** Strip the frontmatter fence — what the skill loader actually delivers. */
function bodyOf(md: string): string {
  const m = md.match(/^---\n[\s\S]*?\n---\n/);
  return m ? md.slice(m[0].length) : md;
}

/** Slice a `## <heading>` section out of a Markdown file, by heading LINE. */
function section(md: string, heading: string): string {
  // Anchored on the heading line, never on the first occurrence of the string:
  // these documents mention their own section names in prose. The slice ends at
  // the next `## `, so a `### ` sub-heading stays inside its parent section —
  // which is what lets a caller assert on a sub-block through its parent.
  const start = md.search(new RegExp(`^## ${heading}$`, 'm'));
  if (start < 0) throw new Error(`no '## ${heading}' heading`);
  const next = md.indexOf('\n## ', start + 1);
  return next < 0 ? md.slice(start) : md.slice(start, next);
}

// H3-anchored: bounded by the next H2 or H3, whichever comes first — never the
// first occurrence of the heading text in prose (documents cite their own
// subsection names).
function subsection(md: string, heading: string): string {
  const start = md.search(new RegExp(`^### ${heading}$`, 'm'));
  if (start < 0) throw new Error(`no '### ${heading}' heading`);
  const nextH2 = md.indexOf('\n## ', start + 1);
  const nextH3 = md.indexOf('\n### ', start + 1);
  const candidates = [nextH2, nextH3].filter((i) => i >= 0);
  const next = candidates.length ? Math.min(...candidates) : -1;
  return next < 0 ? md.slice(start) : md.slice(start, next);
}

/**
 * Every clause the ONE canonical rule must carry (AC 1-4).
 *
 * Assertions run against a whitespace-collapsed copy: this is prose wrapped at
 * ~100 columns, so a required phrase such as `publishing a comment` legitimately
 * straddles a line break. Pinning the wrap instead of the wording would fail the
 * suite on any future reflow for no behavioural reason. Each clause is a separate
 * assertion, so dropping any one turns the suite red (AC 6).
 */
function expectTheRule(text: string): void {
  const flat = text.replace(/\s+/g, ' ');
  expect(flat).toMatch(/binding/i);
  expect(flat).toMatch(/complete\**\s+`SKILL\.md`/); // the FULL read, not a skim
  expect(flat).toMatch(/announce/); // observable compliance
  expect(flat).toMatch(/does\s+(?:\*\*)?not(?:\*\*)?\s+count/); // no substitution
  expect(flat).toMatch(/[Ee]quivalent reasoning/);
  expect(flat).toMatch(/paraphras/);
  expect(flat).toMatch(/advisory/i); // the explicit, disclosed exception
  expect(flat).toMatch(/\bstop\b/); // fail closed
  expect(flat).toMatch(/exact identifier/); // names what failed
  for (const effect of [
    'editing a file',
    'committing',
    'publishing a comment',
    'asking for confirmation',
    'transitioning',
  ]) {
    expect(flat).toContain(effect);
  }
}

describe('BB-280 required skill dependencies (AC 1-6)', () => {
  // Each site: the input it must load, and the step section the pointer lives in
  // (whole body when the skill has no step sections).

  it('the rule is written once, in full, in WORKFLOW.md (AC 1, 2, 3, 4)', () => {
    expectTheRule(section(read(WORKFLOW_MD), 'Required skills'));
  });

  it('the minimal template requires skills before acting and stops when unavailable', () => {
    const tpl = read(TEMPLATE_MD);
    expect(section(tpl, 'Required skills')).toMatch(
      /required skills before acting/,
    );
    expect(section(tpl, 'Required skills')).toMatch(
      /unavailable, stop and name it/,
    );
    expect(() => parseStepValues(tpl)).not.toThrow();
  });

  it('EVERY skill declaring a `.prompt` input points at the rule (AC 1, 4)', () => {
    // Derived, not handpicked. An earlier version listed the sites by hand and so
    // asserted "every site" while silently skipping five — `release.prompt`,
    // `health.prompt`, `verify.prompt` and both code `build.prompt` sites. A
    // `.prompt` value is binding whether or not its current default happens to
    // name a skill, so any skill that declares one must reference the rule; and a
    // NEW `.prompt` input cannot ship unguarded.
    const unlinked: string[] = [];
    for (const dir of readdirSync(SKILLS_DIR)) {
      const file = resolve(SKILLS_DIR, dir, 'SKILL.md');
      if (!existsSync(file)) continue;
      const md = read(file);
      const prompts = readSkillWhen(md).inputs.filter((i) =>
        i.key.endsWith('.prompt'),
      );
      if (prompts.length === 0) continue;
      const flat = bodyOf(md).replace(/\s+/g, ' ');
      if (!/Required\s+skills\*{0,2}/.test(flat)) unlinked.push(dir);
      for (const p of prompts) {
        expect(flat, `${dir} must name \`${p.key}\` in its body`).toContain(
          `\`${p.key}\``,
        );
      }
    }
    expect(
      unlinked,
      `these skills declare a .prompt input but never point at WORKFLOW.md › Required skills: ${unlinked.join(', ')}`,
    ).toEqual([]);
  });

  it('S8 the additional skill list is bound by the same rule, not a second copy (AC 1, 3)', () => {
    const skills = section(read(WORKFLOW_MD), 'Skills').replace(/\s+/g, ' ');
    expect(skills).toMatch(/binding/i);
    expect(skills).toMatch(/Required\s+skills/);
    // the rule must NOT be restated here — that duplication is what this replaces
    expect(skills).not.toMatch(/complete\**\s+`SKILL\.md`/);
  });

  it('every input key is `<role>.<kind>` with a known kind (BB-280 D6)', () => {
    const KINDS = new Set(['command', 'prompt', 'data']);
    for (const dir of readdirSync(SKILLS_DIR)) {
      const file = resolve(SKILLS_DIR, dir, 'SKILL.md');
      if (!existsSync(file)) continue;
      for (const input of readSkillWhen(read(file)).inputs) {
        const parts = input.key.split('.');
        expect(
          parts,
          `${dir}: input key \`${input.key}\` must be <role>.<kind>`,
        ).toHaveLength(2);
        expect(parts[0].length).toBeGreaterThan(0);
        expect(
          KINDS.has(parts[1]),
          `${dir}: input key \`${input.key}\` must end in .command, .prompt or .data`,
        ).toBe(true);
      }
    }
  });

  it('workflow-step declares the convention and drops the "no type" clause', () => {
    const ws = readSkill('workflow-step');
    expect(ws).toMatch(/<role>\.<kind>/);
    expect(ws).toMatch(/followed verbatim/);
    expect(ws).toMatch(/run verbatim/);
    expect(ws).toMatch(/looked up/);
    // the clause that licensed paraphrasing a prompt value
    expect(ws).not.toMatch(/no type is encoded in the name/);
  });
});

// ---------------------------------------------------------------------------
// BB-371 — the workflow surface tells one story about evidence.
//
// The retired model was *path + run ID + repository-or-CI-artifact URL*; the
// durable triad is now **command + observed result + commit** (D2), and what a
// run writes is transient and gitignored (D1). Rewriting the skills is only
// half the job: the strings a running agent actually reads live in three more
// places, and each one had survived the rewrite.
//
// These are guards rather than notes because each retired string is *load-
// bearing*. A skill is what a running agent reads; a
// `review.prompt` in `WORKFLOW.md` **wins over the skill it overrides**, so a
// contradiction there is the version that ships. They live here, in the suite
// the `conductor` CI job runs.
// ---------------------------------------------------------------------------

const CLAUDE_DIR = resolve(REPO_ROOT, '.claude');
const GITIGNORE = resolve(REPO_ROOT, '.gitignore');

/** Every file under `dir`, recursively, as absolute paths. Excludes `worktrees` and `.dropsh` directories (caches and separate clones that would cause excessive recursion). */
function walkFiles(dir: string): string[] {
  const out: string[] = [];
  const queue: string[] = [dir];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name);
      if (
        entry.isDirectory() &&
        !entry.isSymbolicLink() &&
        entry.name !== 'worktrees' &&
        entry.name !== '.dropsh'
      ) {
        queue.push(path);
      } else if (entry.isFile()) {
        out.push(path);
      }
    }
  }
  return out;
}

describe('BB-371 no artifact publishes the retired evidence model', () => {
  /**
   * The retired vocabulary, each entry a distinct half of the old model: the
   * two triad wordings (`run ID`, `repository or CI artifact URL`) and the two
   * path levels of the retired root (`attempt-<n>`, `e2e-testing`), plus the
   * deleted archive (`docs/evidence`).
   */
  const RETIRED = [
    'run ID',
    'repository or CI artifact URL',
    'attempt-<n>',
    'e2e-testing',
    'docs/evidence',
  ] as const;

  /**
   * `upgrade-project` names the retired paths **because it migrates them** —
   * it is the one skill whose job is to recognise the old shape in a consumer
   * repository and replace it. Excluding it is the difference between "the
   * model is retired" and "the word is banned", and only the first is true.
   */
  const MIGRATOR = resolve(
    CLAUDE_DIR,
    'skills/bakers-build/skills/upgrade-project/SKILL.md',
  );

  it('no skill or loader still names it (the migrator excepted)', () => {
    const files = [...walkFiles(CLAUDE_DIR), WORKFLOW_MD].filter(
      (file) => file !== MIGRATOR,
    );

    const offenders: string[] = [];
    for (const file of files) {
      const lines = read(file).split('\n');
      lines.forEach((line, index) => {
        for (const term of RETIRED) {
          if (line.includes(term)) {
            offenders.push(
              `${file.slice(REPO_ROOT.length + 1)}:${index + 1} — ${term}`,
            );
          }
        }
      });
    }
    expect(
      offenders,
      `the retired evidence model survives here:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('the migrator is excepted deliberately, and still does its job', () => {
    // If the exception above ever stops being load-bearing, this fails and the
    // exclusion should go rather than sit there silently widening the guard.
    const md = read(MIGRATOR);
    expect(md).toMatch(/docs\/evidence/);
    expect(md).toMatch(/delete|migrat/i);
  });
});

describe('BB-371 the ignore entry is asserted where CI can see it', () => {
  // The one assertion this suite owns for the transient root.
  it('.gitignore ignores the transient root and no longer ignores the retired one', () => {
    const gitignore = read(GITIGNORE);
    expect(gitignore).toMatch(/^\/assets-ai\/$/m);
    expect(gitignore).not.toMatch(/^\/issues\/$/m);
  });
});

describe('BB-431 `## Skill set` is a list and the choice is a ticket label', () => {
  const selecting = () =>
    stepSection(readSkill('method-context'), 'Selecting the skill set');

  it('this repository ships the list form, and the one-entry no-op is pinned to a reduction of it (AC2)', () => {
    // BB-444 adopted the list form as the shipped default (superpowers first). The strongest
    // form of "one entry changes nothing" is now a reduction of the real file to its first entry.
    const wf = read(WORKFLOW_MD);
    expect(skillSetEntries(wf)).toEqual(['superpowers', 'matt']);
    expect(skillSetEntries(withOneSkillSet(wf))).toEqual(['superpowers']);
  });

  // A reference line may legitimately be mentioned in prose as well, and the two-entry rewrite
  // must reach only the one inside `## Skill set`. Asserting this against the real WORKFLOW.md
  // would pass either way — that line occurs exactly once there, so a document-wide replace
  // looks correct by luck. The mention therefore goes BEFORE the section, where a document-wide
  // replace rewrites the prose and leaves the section at one entry.
  it('the two-entry rewrite reaches the section and leaves prose alone', () => {
    // Reduce the shipped list form to one entry first, so the rewrite has a single entry to grow
    // and the section-scoped splice property is what is under test, not the file's own shape.
    const wf = withOneSkillSet(read(WORKFLOW_MD));
    const entry = section(wf, 'Skill set').trim();
    const mention = `Historically we also linked ${entry} in prose.`;
    const listed = withTwoSkillSets(
      wf.replace('## Skill set', `${mention}\n\n## Skill set`),
    );
    expect(skillSetEntries(listed)).toEqual(['superpowers', 'matt']);
    expect(listed).toContain(mention);
  });

  it('method-context documents the list form, the positional default, and the one-entry no-op (AC1, AC2)', () => {
    const md = readSkill('method-context');
    expect(md).toMatch(/first entry\s+is default/);
    expect(md).toMatch(/one available entry needs no question/);
    expect(md).toMatch(/multiple entries offer all\s+available sets/);
  });

  it('method-context derives the set name from the reference basename, set-agnostic (AC1, BB-444)', () => {
    const md = readSkill('method-context');
    expect(md).toMatch(/names are reference basenames without `.md`/);
  });

  it('method-context owns the label write, the idempotent term, and the one-label rule (AC5)', () => {
    const md = readSkill('method-context');
    expect(md).toMatch(/Persist one `method:<set>` label/);
    expect(md).toMatch(/preserving other labels/);
    expect(md).toMatch(/idempotent term creation/);
    expect(md).toMatch(/--workspace_id/);
  });

  it('method-context fixes the handoff line and both of its provenances (AC6, AC7)', () => {
    const md = readSkill('method-context');
    expect(md).toMatch(
      /record confirmed\/default status in the typed qualification handoff/,
    );
  });

  it('method-context resolves downstream label-first and routes a revision through scope-change (AC8, AC9)', () => {
    const md = readSkill('method-context');
    expect(md).toMatch(
      /Later states resolve the standing label or first available default/,
    );
    expect(md).toMatch(/Changes follow `@bakers-build\/scope-change`/);
  });

  it('the switch sentence describes a list, not a single reference (AC1)', () => {
    const md = readSkill('method-context');
    expect(md).toMatch(/Skill set selects the method/);
    expect(md).toMatch(
      /Recognize Markdown links or `@bakers-build\/method-context` references/,
    );
  });

  // BB-444 reversed the BB-431 timing: the method is chosen at QUALIFICATION, not at the first
  // work step. So the work-step owners no longer ask — they RESOLVE the method from the `method:*`
  // label and must not re-ask. This pins that new contract, and its inverse (they don't select).
  it('the work-step owners resolve the method from the label, not ask (BB-444)', () => {
    const resolving = [
      {
        skill: 'create-spec',
        step: 'spec',
        invoke: /Invoke the selected specification method/,
      },
      {
        skill: 'docs-authoring',
        step: 'spec',
        invoke: /Invoke the selected specification method/,
      },
      {
        skill: 'diagnose-ticket',
        step: null,
        invoke: /invoke the\s+selected diagnosis method/,
      },
    ] as const;

    for (const { skill, step, invoke } of resolving) {
      const md = readSkill(skill);
      const body = step === null ? md : stepSection(md, step);
      const resolve = body.search(/Selecting the skill set/);
      const invoked = body.search(invoke);
      expect(resolve, `${skill} must resolve from the label`).toBeGreaterThan(
        -1,
      );
      expect(invoked, `${skill} never invokes its method`).toBeGreaterThan(-1);
      expect(
        resolve,
        `${skill} must resolve the label before invoking its method`,
      ).toBeLessThan(invoked);
      expect(selecting()).toMatch(/Reuse confirmed choices/);
      expect(body).toMatch(/@bakers-build\/method-context/);
    }
  });

  it('qualification owns the method choice (BB-444)', () => {
    const md = readSkill('method-context');
    expect(md).toMatch(/Qualification chooses once/);
    expect(md).toMatch(/Qualification selects but does not execute the method/);
  });

  it('docs-authoring coding resolves the method from the label before the section (AC8)', () => {
    const coding = codingInstructions('docs-authoring');
    const label = coding.search(/method:\*/);
    const fallback = coding.search(/`Skill set`/);
    expect(label).toBeGreaterThan(-1);
    expect(fallback).toBeGreaterThan(-1);
    expect(
      label,
      'the `method:*` label must be read before the `Skill set` fallback',
    ).toBeLessThan(fallback);
    expect(coding).toMatch(/fall(?:s|ing)? back/i);
  });

  it('the template names no set and still parses (init asks instead)', () => {
    // Copying the template used to hand every new project both sets with the
    // first as an unchosen default; init now asks and writes back exactly
    // what was picked, so the template itself carries none.
    const tpl = read(TEMPLATE_MD);
    expect(skillSetEntries(tpl)).toEqual([]);
    expect(() => parseStepValues(tpl)).not.toThrow();
  });

  it('no supporting prose still describes a single skill-set reference (AC1)', () => {
    const readme = read(README_MD);
    expect(readme).toMatch(/^\| Skill set \|.*one or more/im);
    expect(readme).not.toMatch(/^\| Skill set \| One reference/m);

    for (const skill of ['init-project', 'upgrade-project']) {
      const md = read(resolve(SKILLS_DIR, skill, 'SKILL.md'));
      const i = md.indexOf('Skill set');
      expect(i, `${skill} stopped naming the Skill set`).toBeGreaterThan(-1);
      expect(md.slice(i - 200, i + 300)).toMatch(/one or more/i);
    }

    const contract = readSkill('workflow-step');
    expect(contract).toMatch(/one or more/i);
    // The contract names where the answer is recorded, so the wiring cannot rot unnoticed.
    expect(contract).toMatch(/method:\*/);
  });
});

// ---------------------------------------------------------------------------
// BB-402 — the prior-art check is bakers.build policy, not one operator's habit.
//
// Two checkpoints: a search before a ticket is created (and again on every
// qualification — many never passed a create intake at all, and a requalification
// that did was searched against a store that has since moved on), and a re-check
// against `origin/<base_branch>` before a build is dispatched. Both are hard stops,
// because both are the last point at which the duplicated work is still
// avoidable — BB-374 merged BB-349's behaviour 36 minutes before that
// ticket's own run published its acceptance, and the finished build was thrown
// away.
//
// The policy is stated ONCE in `@bakers-build/workflow-step`, which every state prompt
// already loads through the common initial context preflight; the commands live
// with the capabilities that run them. That split is what these assertions
// guard: the policy may not be restated in a body, and the two create-time
// copies of the recipe may not drift apart.
//
// Like the BB-280 and BB-371 blocks above, every prose subject is
// whitespace-collapsed before matching. These bodies wrap at ~100 columns, so a
// required phrase legitimately straddles a line break, and pinning the wrap
// would fail the suite on a reflow for no behavioural reason.
// ---------------------------------------------------------------------------

const PLUGIN_JSON = resolve(
  REPO_ROOT,
  '.claude/skills/bakers-build/.claude-plugin/plugin.json',
);
const GITLAB_CI = resolve(REPO_ROOT, '.gitlab-ci.yml');

describe('skill version gate CI history', () => {
  it('checks out complete history so a release MR always has a merge base', () => {
    const ci = read(GITLAB_CI);
    const job = ci.match(
      /^bb_skill_version_gate:\n([\s\S]*?)(?=^[a-zA-Z_][a-zA-Z0-9_]*:\n)/m,
    )?.[1];

    expect(job).toBeDefined();
    expect(job).toMatch(/\n {2}variables:\n(?: {4}.*\n)*? {4}GIT_DEPTH: "0"\n/);
  });
});

describe('BB-402 prior-art check (R1-R8)', () => {
  const flat = (text: string) => text.replace(/\s+/g, ' ');

  /** The fenced bash blocks of a section, whitespace-collapsed. */
  const bashBlocks = (text: string) =>
    [...text.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => flat(m[1]).trim());

  const CREATE = 'Prior art — search before the live create';
  const QUALIFY = 'Run flow';
  const IMPLEMENT = 'Prior art — re-check the base branch before building';

  /** Numeric per-component compare — `'0.9.0' > '0.18.0'` is true as a string. */
  const isNewerThan = (a: string, b: string) => {
    const left = a.split('.').map(Number);
    const right = b.split('.').map(Number);
    for (let i = 0; i < 3; i += 1) {
      const l = left[i] ?? 0;
      const r = right[i] ?? 0;
      if (l !== r) return l > r;
    }
    return false;
  };

  it('workflow-step states the policy: both checkpoints, the report shape, the hard stop (R7)', () => {
    const md = readSkill('workflow-step');
    expect(md).toMatch(/Before creation and every qualification/);
    expect(md).toMatch(
      /Before building, method-context checks the remote base/,
    );
    expect(md).toMatch(/hit requires a human decision/);
    expect(md).toMatch(/An error is not a negative/);
    expect(md).toMatch(/no label\s+exempts/i);
  });

  it('both create-time recipes reach the complete shared search (R4)', () => {
    for (const [skill, heading] of [
      ['create-ticket', CREATE],
      ['qualify-ticket', QUALIFY],
    ] as const) {
      const recipe = flat(section(bodyOf(readSkill(skill)), heading));
      expect(
        recipe,
        `${skill} must filter a rich-text field on \`.value\``,
      ).toContain('description.value');
      expect(recipe, `${skill} must pass --bundle to search`).toContain(
        '--bundle',
      );
      expect(recipe, `${skill} must state the filter form`).toContain(
        'key:op:value',
      );
      expect(recipe, `${skill} must carry the sanity probe`).toMatch(
        /must return a row/,
      );
      expect(
        recipe,
        `${skill} must run the probe only for an empty result`,
      ).toMatch(/empty/i);
      expect(recipe, `${skill} must search the domain noun`).toMatch(
        /domain noun/i,
      );
      expect(recipe, `${skill} must ask for two spellings`).toMatch(
        /two spellings/,
      );
      expect(recipe, `${skill} must report a hit in full`).toMatch(
        /identifier, title, state, assignee|identifier, title, state and available MR|identifier · title · state · assignee/,
      );
      // The ticket under work carries this ask by definition, so it matches its
      // own search. Without the exclusion the recipe reports the very ticket it
      // was run for and hard-stops the run it was meant to protect.
      expect(
        recipe,
        `${skill} must drop the ticket under work from its own result`,
      ).toMatch(/never its own prior art/i);
    }
  });

  it('create-ticket searches BEFORE the live create (R1)', () => {
    const md = readSkill('create-ticket');
    const searchAt = md.indexOf(`## ${CREATE}`);
    const writeAt = md.search(/bakers dropsh[^\n]*create bb_ticket/);
    expect(
      searchAt,
      'create-ticket must carry the prior-art section',
    ).toBeGreaterThanOrEqual(0);
    expect(
      writeAt,
      'create-ticket must still carry the create',
    ).toBeGreaterThanOrEqual(0);
    // A search that runs after the write has already produced the duplicate.
    expect(searchAt, 'the search must precede the create command').toBeLessThan(
      writeAt,
    );
    expect(md, 'the write sequence keeps its own heading').toMatch(
      /^## The write$/m,
    );
    expect(
      md.indexOf('## The write'),
      'the write section follows the search',
    ).toBeGreaterThan(searchAt);
    expect(flat(section(bodyOf(md), CREATE)), 'a hit stops the create').toMatch(
      /stop before\s+writing/i,
    );
  });

  it('the two create-time recipes cannot drift apart (R-5)', () => {
    const createSection = section(bodyOf(readSkill('create-ticket')), CREATE);
    const qualifySection = section(
      bodyOf(readSkill('qualify-ticket')),
      QUALIFY,
    );

    const create = bashBlocks(createSection);
    expect(create.length, 'the recipe must ship its commands').toBeGreaterThan(
      0,
    );
    expect(bashBlocks(qualifySection)).toEqual(create);
    for (const name of ['create-ticket', 'qualify-ticket']) {
      expect(read(resolve(SKILLS_DIR, name, 'SKILL.md'))).toContain(
        '../workflow-step/references/prior-art-search.md',
      );
    }
  });

  it('qualify-ticket runs the search on every qualification, before the intake (R2)', () => {
    const md = readSkill('qualify-ticket');
    expect(md).toMatch(
      /Read complete context[\s\S]*Search prior art[\s\S]*@bakers-build\/run-intake/,
    );
    expect(md).toMatch(/On a hit, publish nothing,\s+transition nothing/);
  });

  it('method-context re-checks the base branch before the owner builds (R3)', () => {
    const body = bodyOf(readSkill('method-context'));
    const recheck = flat(section(body, IMPLEMENT));
    expect(recheck, 'a stale remote ref answers the wrong question').toContain(
      'git fetch',
    );
    expect(recheck, 'the check reads the remote, not the worktree').toContain(
      'origin/',
    );
    expect(recheck, 'an empty grep needs its probe too').toMatch(/probe/i);
    // The dropsh recipes carry this fact; the git batch is the checkpoint whose
    // whole purpose is not to build something twice, so "the fetch failed and I
    // read the log as clean" is exactly the way it silently stops working.
    expect(recheck, 'a failed git command is not a clean base branch').toMatch(
      /error is not a negative/i,
    );
    // Re-measured on git 2.34.1 rather than inherited from the prose: against a
    // ref that does not resolve, `git grep` exits 128 saying `fatal: unable to
    // resolve revision`, while the batch's `git log` limb is the one that says
    // `fatal: ambiguous argument`. Both exit 128, and it is the exit CODE, not
    // the string, that separates a broken ref from the exit 1 of a real absence.
    // So this pin admits either message: pinning one of them made the suite
    // self-preserving, because the next author who corrected the attribution got
    // a red test whose message argued for the falsehood.
    expect(
      recheck,
      'the prose must name a symptom git actually emits for a ref that does not resolve',
    ).toMatch(/ambiguous argument|unable to resolve revision/);
    expect(
      recheck,
      'the symptom must be attributed to the command that emits it — `git grep` reports `unable to resolve revision`',
    ).toMatch(/git grep`?[\s\S]{0,200}unable to resolve revision/i);
    expect(
      recheck,
      'the exit code is what separates a broken ref from a real absence, so both codes must survive the correction',
    ).toMatch(/\b128\b[\s\S]{0,240}exit \*\*1\*\*/);
    // Exit 1 is `git grep`'s no-match and nothing else's. Re-measured on git
    // 2.34.1: `git log --oneline origin/develop --grep=<absent token>` exits 0,
    // `git grep -nEi <absent token> origin/develop -- .claude` exits 1. Naming
    // only the 1 leaves a reader to generalise it across both limbs, and on the
    // `git log` limb that generalisation is the silent failure this whole check
    // exists to prevent: the agent waits for a 1 that never comes, reads the 0
    // as "the command succeeded, so it found something", and either invents a
    // hit or stops trusting the limb.
    expect(
      recheck,
      "exit **1** is `git grep`'s no-match alone — `git log` exits **0** with nothing to show, so a reader who takes 1 as the negative for both limbs reads a clean run as a hit that never came",
    ).toMatch(/git log`?[\s\S]{0,120}exits? \*\*0\*\*/i);
    expect(
      recheck,
      'the operative rule is to read each command status, not its empty output',
    ).toMatch(/status rather than its empty output/i);
    expect(recheck, 'the outcome is returned, not acted on').toContain(
      'prior_art_hit',
    );
    // "build nothing" since BB-424 — the owner builds, nothing dispatches. The older
    // spelling is still admitted so a later merge from a branch that kept the dispatcher
    // does not fail for a word.
    expect(recheck, 'a hit builds nothing').toMatch(
      /(build|dispatch) nothing/i,
    );
    expect(recheck, 'this skill takes no confirmation of its own').toMatch(
      /no confirmation of its own/i,
    );

    // R5 stands or falls on this command: the re-check finds a candidate commit,
    // and only the `ref:` trailer turns that sha into the identifier, title,
    // state and assignee a hit has to be reported as. The shipped command could
    // not print one. `--grep` SELECTS on the trailer while `%s` prints only the
    // subject, so it matched exactly the right commits and then showed nothing
    // to read — this branch's own captures ran it verbatim twice
    // (`assets-ai/BB-402/git/coding-entry-recheck-ef9ca736.txt:32-36` and
    // `assets-ai/BB-402/git/recipe-as-shipped.txt`) and recorded subject lines
    // with not one identifier among them, and nobody noticed. The same parse is
    // already done correctly in this repository:
    // `bakers-cli/addons/deployment/src/deployment.ts:152` uses `%H %s%n%b`.
    expect(
      recheck,
      'the trailer lives in the commit body, so a format without %b selects the right commits and prints nothing readable',
    ).toContain('%b');
    // A sweep of 20 arbitrary recent commits answers a different question than
    // "which ticket delivered THIS candidate".
    expect(
      recheck,
      'the resolution must be scoped to the candidate the re-check found, not a sweep of recent history',
    ).toMatch(/git log -1/);
    // The owner of this re-check is `method-context` — `implement-ticket` when BB-402
    // shipped it, until BB-424 retired that skill — so an improvised `dropsh
    // read` written here would pass unnoticed. `@bakers-build/read-ticket`
    // owns the canonical read and resolves an identifier to a UUID; naming the
    // route is what keeps the widened boundary from becoming a licence.
    expect(
      recheck,
      'the ticket read must be routed to the capability that owns it',
    ).toContain('@bakers-build/read-ticket');
    // `<identifier>` carries the project's own key, so a grep for a literal key
    // finds nothing on any project that is not bakers.build — the silent negative this
    // whole checkpoint exists to prevent.
    expect(
      recheck,
      'the grep must not hardcode a project key: the trailer is ref:<identifier>, and the identifier carries its own key',
    ).not.toMatch(/--grep=\S*ref:[A-Z]+-/);

    const checkAt = body.indexOf(`## ${IMPLEMENT}`);
    // BB-424's owner calls the implementation method directly, so that sentence is the
    // build instruction this checkpoint has to precede — the dispatcher it used to precede
    // (`dispatch.prompt`) went with the retired skill.
    // The anchor stops before the hard wrap: the sentence reads "calls the original
    // implementation\nmethod directly", and a literal spanning that newline never matches.
    const buildAt = body.indexOf('calls the original implementation');
    expect(
      buildAt,
      'the build instruction must survive',
    ).toBeGreaterThanOrEqual(0);
    expect(
      checkAt,
      'a re-check after the build instruction has lost the build',
    ).toBeLessThan(buildAt);
  });

  it('every coding step owner consumes prior_art_hit (R3)', () => {
    // A returned outcome with no consumer is a dead letter. Without this clause
    // the coding step walks from the pre-build base check straight into a
    // GREEN gate that a hit can never satisfy, because no build ran — the same
    // reason `returned_to_qualification` is named on both sides.
    for (const owner of [
      'ddev-drupal-bug',
      'ddev-drupal-feature',
      'docs-authoring',
    ]) {
      const coding = flat(codingInstructions(owner));
      expect(
        coding,
        `${owner} must name the outcome the pre-build re-check returns instead of a build`,
      ).toContain('prior_art_hit');
      expect(
        coding,
        `${owner} must stop on a hit rather than fall through to the GREEN gate`,
      ).toMatch(/prior_art_hit[\s\S]{0,80}STOP/);
    }
  });

  it('the policy is written ONCE — no other skill body restates it (R7)', () => {
    const policy = section(
      read(resolve(SKILLS_DIR, 'workflow-step/SKILL.md')),
      'Prior art',
    );
    expect(policy).toMatch(/Before creation and every qualification/);
    expect(policy).toMatch(
      /Before building, method-context checks the remote base/,
    );
    for (const name of ['create-ticket', 'qualify-ticket']) {
      expect(read(resolve(SKILLS_DIR, name, 'SKILL.md'))).toContain(
        '../workflow-step/references/prior-art-search.md',
      );
    }
  });

  it('the skill set ships a new version (R8)', () => {
    const { version } = JSON.parse(read(PLUGIN_JSON)) as { version: string };
    // The baseline is what `develop` ships, not what it shipped when this ticket
    // opened. BB-402 landed 0.20.0 on develop while this branch already held it,
    // and two branches bumping to the SAME version net to zero on merge — the skill
    // set then changes with its version untouched and reaches no consumer. Raise this
    // baseline whenever develop moves past it, and bump plugin.json with it.
    expect(
      isNewerThan(version, '0.20.0'),
      `plugin.json still ships ${version}; a changed skill set that keeps its version reaches no consumer`,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// BB-436 — the step-contract loader degrades silently.
//
// Two defects, plus a third the ticket's framing folds into the first:
//   1. `validateLoad` has no production caller, so nothing enforces the contract.
//   1b. `validateLoad` carries no unknown-override-key check at all, so wiring a
//       caller alone would still not satisfy AC1.
//   2. `BULLET` hardcodes the `@bakers-build/` namespace, so a bullet in any other
//      namespace is neither resolved nor reported — and, because a top-level
//      bullet sits at indent 0, it additionally discards the inline overrides of
//      the bullet it follows.
//
// These are RED on purpose: each one asserts the behaviour the ticket's
// acceptance criteria require, against a loader that does not yet provide it.
// ---------------------------------------------------------------------------

describe('BB-436 — the loader reports what it cannot honour', () => {
  const FOREIGN_SKILL = [
    '---',
    'name: config-sync',
    'description: a step owner shipped from another repo, addressed in its own namespace.',
    'when:',
    '  work_type: config-sync',
    '  workflow: [bb_bug]',
    '  step: [diagnose]',
    'inputs:',
    '  validate.command:',
    '    description: command that validates the synced config',
    '    default: "@example/sync-verify"',
    '---',
    '',
    '# Config sync',
  ].join('\n');

  const foreignByName = () =>
    new Map([['config-sync', readSkillWhen(FOREIGN_SKILL)]]);

  const loader = (...bullets: string[]) =>
    ['# X', '', '## Loaded skills', '', ...bullets, ''].join('\n');

  // AC3 — a bullet in a namespace other than `@bakers-build/` is resolved as a skill
  // name, its declared inputs are read, and its inline overrides reach it.
  it('resolves a bullet in a namespace other than @bakers-build/ (AC3)', () => {
    const md = loader(
      '- @example/config-sync',
      '    validate.command: "@example/sync-verify --strict"',
    );

    const { skills, values } = expandLoad(md, foreignByName());

    expect(
      skills.map((s) => s.name),
      'a @example/ bullet names a real, loadable step owner; the loader must see it',
    ).toEqual(['config-sync']);
    expect(
      values['config-sync']?.['validate.command'],
      'an inline override written under a foreign-namespace bullet must reach that skill',
    ).toBe('@example/sync-verify --strict');
  });

  // AC4 — an unresolvable bullet is an error rather than a silent drop. Today
  // this holds for `@bakers-build/` and fails for every other namespace, so the loader
  // is silent exactly where a project cannot diagnose it.
  it('reports an unresolvable bullet in any namespace (AC4)', () => {
    expect(
      () => expandLoad(loader('- @nope/not-a-real-skill'), foreignByName()),
      'an unresolvable bullet must be reported, not dropped into silence',
    ).toThrow(StepContractError);
  });

  // Defect 2's second, unreported consequence: a top-level bullet sits at
  // indent 0, so an unmatched one takes the "dedented prose ends the current
  // skill's values" branch and discards the *preceding* bullet's overrides.
  it('a foreign bullet does not strip the previous skill overrides (AC4)', () => {
    const byName = foreignByName();
    byName.set('ddev-drupal-bug', readSkillWhen(readSkill('ddev-drupal-bug')));

    const md = loader(
      '- @bakers-build/ddev-drupal-bug',
      '- @example/config-sync',
      '    validate.command: "ddev bakers-test-e2e"',
    );

    // Whatever the loader does with the foreign bullet, it must not silently
    // reassign or discard an override the project wrote under another skill.
    let values: StepValues;
    try {
      ({ values } = expandLoad(md, byName));
    } catch {
      return; // reporting the foreign bullet is an acceptable outcome (AC4)
    }
    expect(
      values['ddev-drupal-bug']?.['validate.command'],
      'the override belongs to config-sync; ddev-drupal-bug must not silently inherit or lose values because of an unparsed neighbour',
    ).toBeUndefined();
    expect(
      values['config-sync']?.['validate.command'],
      'the override written under the foreign bullet must reach the skill it was written for',
    ).toBe('ddev bakers-test-e2e');
  });

  // AC1 — an override key matching no declared input of its skill is reported,
  // naming both the skill and the key. `validateLoad` has no such check today,
  // so this stays RED even once a caller exists.
  it('reports an override key that matches no declared input (AC1)', () => {
    const bug = readSkillWhen(readSkill('ddev-drupal-bug'));
    const byName = new Map([['ddev-drupal-bug', bug]]);
    // The pre-BB-280 bare key: the skill declares `validate.command`.
    const md = loader(
      '- @bakers-build/ddev-drupal-bug',
      '    validate: "ddev bakers-test-e2e"',
    );
    const { skills, values } = expandLoad(md, byName);
    const triples: Triple[] = [
      { work_type: 'code', workflow: 'bb_bug', step: 'diagnose' },
    ];

    let message: string | null = null;
    try {
      validateLoad(skills, values, triples);
    } catch (e) {
      message = (e as Error).message;
    }

    expect(
      message,
      'an override key that resolves to nothing must fail the load, not fall back to the skill default in silence',
    ).not.toBeNull();
    expect(message).toContain('ddev-drupal-bug');
    expect(message).toContain('validate');
  });

  // AC1/AC2 — the contract is enforced through a normal bakers.build entry point, not
  // only when an agent runs the check by hand. A caller must exist somewhere in
  // the shipped source outside the module that defines it and its own tests.
  it('validateLoad has a caller in the shipped source (AC1, AC2)', () => {
    const CLI_SRC = resolve(REPO_ROOT, 'bakers-cli');
    const callers: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === 'dist') continue;
        const p = resolve(dir, e.name);
        if (e.isDirectory()) {
          walk(p);
          continue;
        }
        if (!e.name.endsWith('.ts')) continue;
        // Skip the definition itself, the barrel re-export, and every test.
        if (p.endsWith('workflow/step-contract.ts')) continue;
        if (p.endsWith('core/src/index.ts')) continue;
        if (p.includes('/tests/')) continue;
        if (read(p).includes('validateLoad(')) callers.push(p);
      }
    };
    walk(CLI_SRC);

    expect(
      callers,
      'validateLoad is exported and never invoked: no CLI command and no conductor path runs it, so a drifted WORKFLOW.md degrades silently',
    ).not.toEqual([]);
  });

  // AC6 — `@bakers-build/upgrade-project` claims a missed key throws. Either the code
  // makes that true, or the prose is corrected.
  it('upgrade-project\'s "loud, not silent" claim matches the code (AC6)', () => {
    const prose = readSkill('upgrade-project');
    const claims = prose.includes('**loud, not silent**');
    if (!claims) return; // the prose was corrected instead — equally valid

    const bug = readSkillWhen(readSkill('ddev-drupal-bug'));
    const md = loader('- @bakers-build/ddev-drupal-bug', '    validate: "x"');
    const { skills, values } = expandLoad(
      md,
      new Map([['ddev-drupal-bug', bug]]),
    );
    expect(
      () =>
        validateLoad(skills, values, [
          { work_type: 'code', workflow: 'bb_bug', step: 'diagnose' },
        ]),
      'upgrade-project promises validateLoad throws naming the skill and key; make it true or correct the prose',
    ).toThrow(StepContractError);
  });

  // BB-436 review finding — the reporting branch above must fire on a bullet
  // it is actually the only path for. The AC4 test uses `- @nope/not-a-real-skill`,
  // which `BULLET` parses fine, so it exercises the pre-existing unknown-NAME
  // path in `expandLoad`, never the unreadable-ADDRESS path in the parser. This
  // one is unparseable by construction (uppercase, underscores), so nothing but
  // the new branch can report it.
  it('reports a top-level bullet BULLET itself cannot read (AC4)', () => {
    expect(
      () => parseStepValues(loader('- @Example_Plugin/Config_Sync')),
      'a bullet-shaped address the loader cannot parse must be reported by the parser, not taken for prose',
    ).toThrow(StepContractError);
  });

  // BB-436 review finding, the blocking one — a `- @…` list item inside a
  // `.prompt` block scalar is VALUE, not an address. `BULLET`/`BULLET_SHAPED`
  // are matched before `indent` is known, so an unanchored pattern reads a
  // nested line as a top-level bullet. Both halves of that are defects:
  //   - the near-miss (`- @bakers-build/read-ticket before anything else.`) is reported,
  //     failing a document that parsed correctly before the reporting branch;
  //   - the exact hit (`- @bakers-build/read-ticket`) is worse and pre-existing: it
  //     truncates the block scalar mid-value and invents a phantom skill, and
  //     `validateLoad` then reports the corrupted load as clean.
  // A top-level bullet sits at indent 0 in `WORKFLOW.md` and in a bundle body
  // alike, so anchoring both patterns there fixes the pair at once.
  it('a `- @…` line inside a block scalar is value, not an address (AC4)', () => {
    const md = [
      '# X',
      '',
      '## Loaded skills',
      '',
      '- @bakers-build/ddev-drupal-bug',
      '    build.prompt: |',
      '      Isolate the cause first.',
      '      Required reading:',
      '      - @bakers-build/read-ticket before anything else.',
      '      - @bakers-build/verify-tests',
      '      Then report what you observed.',
      '    validate.command: ddev bakers-test-e2e',
      '',
    ].join('\n');

    const values = parseStepValues(md);

    const prompt = values['ddev-drupal-bug']?.['build.prompt'] ?? '';
    expect(
      prompt,
      'a nested `- @…` line belongs to the block scalar; reporting it fails a document that is correct',
    ).toContain('@bakers-build/read-ticket before anything else.');
    expect(
      prompt,
      'an exact-form `- @…` inside the scalar must not truncate the value it sits in',
    ).toContain('Then report what you observed.');
    expect(
      Object.keys(values),
      'a nested `- @…` line must not be read as a load site: no phantom skill',
    ).toEqual(['ddev-drupal-bug']);
    expect(
      values['ddev-drupal-bug']?.['validate.command'],
      'the override after the block scalar must survive: nothing was flushed away',
    ).toBe('ddev bakers-test-e2e');
  });

  /**
   * The override snippet shipped by publish-origin-status: the
   * contiguous run of non-blank lines around the `- @bakers-build/publish-origin-status`
   * bullet, with any code-fence marker dropped.
   *
   * Read out of the shipped file rather than duplicated here — a hardcoded copy
   * would keep passing while the template shipped something else, which is the
   * whole thing under test. Located by its bullet rather than by the fence,
   * because that is what a reader selects: the block, never the fence markers.
   */
  const copyMeSnippet = (templateMd: string): string[] => {
    const lines = templateMd.split('\n');
    const at = lines.findIndex((l) =>
      l.trim().startsWith('- @bakers-build/publish-origin-status'),
    );
    expect(
      at,
      'publish-origin-status must carry its configuration example',
    ).toBeGreaterThan(-1);
    let from = at;
    while (from > 0 && (lines[from - 1] ?? '').trim() !== '') from--;
    let to = at;
    while (to + 1 < lines.length && (lines[to + 1] ?? '').trim() !== '') to++;
    return lines.slice(from, to + 1).filter((l) => !l.trim().startsWith('```'));
  };

  /**
   * Paste `snippet` into the template's **own** `## Loaded skills` section, which
   * is what the instruction above the snippet tells the author to do, and return
   * the resulting document.
   *
   * The two positions are the two shapes that instruction can produce, and they
   * fail differently, so both are covered: `after-list` is directly after the
   * final bullet and the override lines under it (what "copy this into the list
   * above" literally says), `end-of-section` is after the section's closing prose
   * (where the review's probe put it — the position whose failure is silent).
   */
  const pasteIntoLoadedSkills = (
    templateMd: string,
    snippet: string[],
    where: 'after-list' | 'end-of-section',
  ): string => {
    const lines = templateMd.split('\n');
    const heading = lines.findIndex((l) => /^##\s+Loaded skills\s*$/.test(l));
    let sectionEnd = lines.length;
    for (let i = heading + 1; i < lines.length; i++) {
      if (/^##\s+/.test(lines[i] ?? '')) {
        sectionEnd = i;
        break;
      }
    }
    let at = sectionEnd;
    if (where === 'after-list') {
      let lastBullet = -1;
      for (let i = heading + 1; i < sectionEnd; i++) {
        if (/^-\s+@/.test(lines[i] ?? '')) lastBullet = i;
      }
      expect(
        lastBullet,
        'the template must still list its skills as bullets at indent 0',
      ).toBeGreaterThan(-1);
      at = lastBullet + 1;
      while (at < sectionEnd && /^\s+\S/.test(lines[at] ?? '')) at++;
    }
    return [...lines.slice(0, at), ...snippet, '', ...lines.slice(at)].join(
      '\n',
    );
  };

  // Paste the owner's real configuration example into both supported positions.
  // Indenting the bullet would silently discard it or corrupt the previous value.
  it('the origin-status snippet pasted at the end of the section is a load site (review round 2)', () => {
    const tpl = read(TEMPLATE_MD);

    const values = parseStepValues(
      pasteIntoLoadedSkills(
        tpl,
        copyMeSnippet(readSkill('publish-origin-status')),
        'end-of-section',
      ),
    );

    expect(
      values['publish-origin-status'],
      'the snippet the owner tells the author to copy must become a load site, not be skipped in silence',
    ).toBeDefined();
    expect(
      values['publish-origin-status']?.['origin_labels.data'] ?? '',
      'the label map written under the snippet must reach publish-origin-status',
    ).toContain('qualification:');
  });

  // The same snippet in the other position the instruction invites — inside the
  // bullet list. There `current` is the previous bullet, so an indented `- @…`
  // line lands in that bullet's inline-YAML buffer: the load fails loudly, but
  // the message blames `docs-authoring`'s YAML for a paste the author made under
  // no skill at all. Loud and misattributed is better than silent, and still wrong.
  it('the origin-status snippet pasted into the bullet list is a load site (review round 2)', () => {
    const tpl = read(TEMPLATE_MD);

    const values = parseStepValues(
      pasteIntoLoadedSkills(
        tpl,
        copyMeSnippet(readSkill('publish-origin-status')),
        'after-list',
      ),
    );

    expect(
      values['publish-origin-status'],
      'pasted into the list, the snippet must load its own skill rather than corrupt the preceding bullet',
    ).toBeDefined();
    expect(
      values['publish-origin-status']?.['origin_labels.data'] ?? '',
      'the label map written under the snippet must reach publish-origin-status',
    ).toContain('qualification:');
  });

  // BB-436 review round 2, folded in — the last shape in which the indent-0
  // anchoring can still misdirect an author. A wholly indented list (what the
  // pre-anchoring pattern accepted, and what a careless paste produces) yields
  // ZERO load sites, and a load of nothing used to surface downstream as
  // `no skill matches triple (—, bb_feature, qualification) — coverage gap`,
  // which sends the author hunting for a missing work-type skill instead of
  // looking at their indentation.
  //
  // `expandLoad` is the seam, not `parseLoadedSection`: a BUNDLE that lists
  // nothing already gets its own name-carrying message from `readSkillWhen`
  // (`\`<name>\`: the \`## Loaded skills\` section lists no skill.`), and a check
  // inside the parser would displace it.
  it('a loader whose only bullets are indented is reported as carrying no load site', () => {
    const md = [
      '# X',
      '',
      '## Loaded skills',
      '',
      '    - @bakers-build/ddev-drupal-bug',
      '    - @bakers-build/qualify-ticket',
      '',
    ].join('\n');

    let error: StepContractError | null = null;
    try {
      expandLoad(md, new Map());
    } catch (e) {
      error = e as StepContractError;
    }

    expect(
      error,
      'a loader that loads nothing must be reported, not expanded into an empty skill set',
    ).not.toBeNull();
    expect(
      error?.message,
      'the message must name the shape a load site takes, and the indent it takes it at',
    ).toContain('indent 0');
    expect(
      error?.message,
      'and must say an indented `- @…` line is value, which is the mistake actually made',
    ).toMatch(/value/);
    expect(
      error?.message,
      'a coverage-gap message points at workflow coverage; the defect is one of indentation',
    ).not.toContain('coverage gap');
    expect(
      error?.code,
      'the empty loader is one of the two classifications a consumer branches on, so it carries a code',
    ).toBe('empty_loader');
  });

  // BB-436 review round 3. The message above is right for ONE of the three
  // shapes that raise `empty_loader` — an indented list. A section holding a `*`
  // marker, or no line at all, is told to de-indent something that is not there.
  // The host distinguishes them, and measures with THIS function rather than with
  // a heading regex of its own: the section's boundary and the shape of an address
  // are rules of this module, and a second copy in the CLI is the drift the ticket
  // is about.
  it('measures an indented list as the lines it found, with their indent', () => {
    const md = [
      '# X',
      '',
      '## Loaded skills',
      '',
      '    - @bakers-build/ddev-drupal-bug',
      '\t- @bakers-build/qualify-ticket',
      '',
    ].join('\n');

    const shape = measureEmptyLoader(md);

    expect(shape.indented.map((s) => s.line)).toEqual([5, 6]);
    expect(
      shape.indented[0],
      'the report points the author at a line, so the measurement carries one',
    ).toMatchObject({ indent: 4, text: '- @bakers-build/ddev-drupal-bug' });
    expect(
      shape.indented[1]?.indent,
      'a TAB indent is an indent too — it is exactly the paste that looks correct',
    ).toBe(1);
  });

  it('measures a section with no address-shaped line as body without load sites', () => {
    const md = [
      '# X',
      '',
      '## Loaded skills',
      '',
      '* @bakers-build/read-ticket',
      '',
    ].join('\n');

    const shape = measureEmptyLoader(md);

    expect(
      shape.indented,
      'a `*` marker is not an indented bullet — nothing here is indented at all',
    ).toEqual([]);
    expect(
      shape.bodyLines,
      'the section does carry a line, so it is not the empty-section shape either',
    ).toBe(1);
  });

  it('measures an empty section as carrying nothing, so it reads as its own shape', () => {
    const md = [
      '# X',
      '',
      '## Loaded skills',
      '',
      '## Next',
      '',
      '- @bakers-build/x',
    ].join('\n');

    const shape = measureEmptyLoader(md);

    expect(shape.indented).toEqual([]);
    expect(
      shape.bodyLines,
      'the section ends at the next `##`, so the bullet below it is not its body',
    ).toBe(0);
  });

  /** A bundle whose body loads a member no index can resolve. */
  const BUNDLE_WITH_UNKNOWN_MEMBER = [
    '---',
    'name: local-bundle',
    'description: a bundle whose body loads a member that is vendored nowhere.',
    '---',
    '',
    '# Bundle',
    '',
    '## Loaded skills',
    '',
    '- @bakers-build/not-vendored-here',
  ].join('\n');

  // BB-436 review round 2, folded in. `host/src/validate.ts` derived its
  // `--skills` discovery hint from a REGEX OVER THIS MODULE'S MESSAGE TEXT
  // (`/^loaded skill \`([^\`]+)\` not found\.$/`), which leaks two ways: the
  // sibling defect the very same `walk()` raises — `bundle \`x\` loads unknown
  // skill \`y\`.` — is just as much a discovery gap and matched nothing, so it got
  // no hint at all; and a reworded message breaks the consumer in silence across
  // the package boundary. A `code` discriminator carries the classification as
  // data, with the unresolved name alongside it, so the host branches on a
  // contract rather than on prose.
  //
  // Only the codes a consumer branches on today exist — `unresolved_skill` and
  // `empty_loader`. The other throw sites stay uncoded on purpose: a code is added
  // when a caller needs to branch on it, not speculatively.
  it('tags an unresolvable root bullet with the unresolved_skill code and its name', () => {
    let error: StepContractError | null = null;
    try {
      expandLoad(loader('- @bakers-build/not-vendored-here'), foreignByName());
    } catch (e) {
      error = e as StepContractError;
    }

    expect(error?.code).toBe('unresolved_skill');
    expect(
      error?.skill,
      'the host names the unresolved skill in its `--skills` hint, so it must not have to re-parse the message for it',
    ).toBe('not-vendored-here');
  });

  // The sibling throw site in the same `walk()`. It is the one the message regex
  // never matched, so it is the reason the discriminator exists at all.
  it('tags an unresolvable bundle MEMBER with the same code and the member name', () => {
    const byName = new Map([
      ['local-bundle', readSkillWhen(BUNDLE_WITH_UNKNOWN_MEMBER)],
    ]);

    let error: StepContractError | null = null;
    try {
      expandLoad(loader('- @bakers-build/local-bundle'), byName);
    } catch (e) {
      error = e as StepContractError;
    }

    expect(
      error?.code,
      'a member that resolves to nothing is the same class of defect as a root bullet that does',
    ).toBe('unresolved_skill');
    expect(
      error?.skill,
      'the name carried is the MEMBER that could not resolve — the bundle itself resolved fine',
    ).toBe('not-vendored-here');
  });
});

// BB-444 — skill hardening: MR links, explained AC verdicts, review-scoped
// fixes, and spec-complete creation. Item 4 (removing to-spec/implement as
// unreachable) was dropped once the KEY-TEC fork of mattpocock/skills made them
// model-invocable — the fork wiring is BB-446's work, so matt.md keeps both
// rows. What remains here: items 3, 1, 2, 5, 6, 7.
// ---------------------------------------------------------------------------

describe('BB-444 item 3 — the acceptance template adopts to-spec improvements', () => {
  it('acceptance requires an exhaustive, actor-named list, traceable to the comparison', () => {
    const md = readSkill('acceptance');
    expect(md).toMatch(/Cover every implied condition/);
    expect(md).toMatch(/As an <actor>[\s\S]{0,80}I want[\s\S]{0,80}so that/);
    expect(md).toMatch(/PM-seeded/);
    expect(md).toMatch(/one standing criterion/);
    expect(md).toMatch(/deduplicating while preserving/);
  });

  it('qualify-ticket requires an out_of_scope field and renders it after acceptance', () => {
    const md = readSkill('qualify-ticket');
    expect(md).toMatch(/Outcome, Acceptance, Out of scope, then Handoff/);
    expect(md).toMatch(/`out_of_scope`: explicit boundary/);
  });

  it('qualification presents explicit routes before agent overrides and treats a lone default as effective', () => {
    const md = readSkill('qualify-ticket');
    expect(md).toMatch(/Present named routes first/);
    expect(md).toMatch(/excluding reserved `default`/);
    expect(md).toMatch(/Offer individual aliases\s+only as useful overrides/);
    expect(md).toMatch(/With only default, report/);
    expect(md).toMatch(/only after explicit confirmation/);
    expect(md).toMatch(/An unattended run writes no agent label/);
  });

  it('create-ticket carries the same out_of_scope field it publishes', () => {
    const md = readSkill('create-ticket');
    expect(md).toMatch(/`out_of_scope`/);
  });
});

describe('BB-444 item 1 — the merge request is mandatory in the link set', () => {
  it('run-outtake reports a missing MR from coding onward', () => {
    const md = readSkill('run-outtake');
    expect(md).toMatch(/from coding onward a missing MR is a run failure/);
    expect(md).toMatch(/Name missing access instead of guessing/);
  });

  it('transition-ticket binds the same rule for the links it writes', () => {
    const md = readSkill('transition-ticket');
    expect(md).toMatch(/coding.*onward[\s\S]{0,60}resolved `MR`/i);
    expect(md).toMatch(/run failure/i);
  });

  it('coding persists its MR before handoff without requiring a transition', () => {
    const delivery = read(
      resolve(SKILLS_DIR, 'method-context/references/delivery.md'),
    );
    expect(delivery).toContain(
      "`@bakers-build/transition-ticket`'s *Links-only write*",
    );
    expect(delivery).toMatch(/verify the saved MR before publishing/);
    expect(delivery).toMatch(/even when remaining in `coding`/);
    const links = section(readSkill('transition-ticket'), 'Links-only write');
    expect(links).toContain('--json links="$LINKS"');
    expect(links).not.toMatch(/^bakers dropsh .*--state/m);
    expect(links).toMatch(/already present[\s\S]*skip the write/);
    expect(links).toMatch(/Read back and verify/);
    expect(links).toMatch(/every existing link/);
    expect(links).toMatch(/failed or uncertain write blocks/i);
  });

  it('the existing no-pipeline-URL rule is untouched', () => {
    expect(readSkill('run-outtake')).toMatch(
      /Never invent URLs or add pipeline URLs/i,
    );
    expect(readSkill('essential-skills')).toMatch(
      /pipeline URLs? (?:is|are) never written/i,
    );
  });

  it('transition-ticket rejects new pipeline links while preserving existing links', () => {
    const md = readSkill('transition-ticket');
    expect(md).toMatch(/Reject newly supplied pipeline/);
    expect(md).toMatch(/-\/pipelines\//);
    expect(md).toMatch(/Preserve every existing link/);
  });
});

describe('BB-444 item 2 — explained acceptance verdicts', () => {
  // run-outtake owns the line shape (the reasoning triad); review-ticket points
  // at it and adds the review-specific rule that a bare verdict is a defect.
  it('run-outtake defines the reasoning the result line carries, PASS as much as FAIL', () => {
    const md = readSkill('run-outtake');
    expect(md).toMatch(/concise reasoning/i);
    expect(md).toMatch(/PASS\/FAIL\/RED\/PENDING/);
    expect(md).toMatch(/bare verdict is a defect/i);
  });

  it('review-ticket carries the reasoning via run-outtake and calls a bare verdict a defect', () => {
    const md = readSkill('review-ticket');
    expect(md).toMatch(/its reasoning/i);
    expect(md).toMatch(/run-outtake` owns the visible format and line shape/i);
    expect(md).toMatch(/bare verdict[\s\S]{0,80}is itself a review\s+defect/i);
  });
});

describe('BB-444 item 5 — review repairs the closed list in place', () => {
  // Single source: method-context defines the closed repair list; the three
  // step owners and review-ticket reference it rather than restating it.
  it('method-context defines the closed repair list once', () => {
    const md = readSkill('method-context');
    expect(md).toMatch(/Only the parent may repair/);
    expect(md).toMatch(/linter\/formatter autofixes/);
    expect(md).toMatch(/documentation wording/);
    expect(md).toMatch(/spec\/acceptance\s+alignment/);
    expect(md).toMatch(/Never behavior, tests or schema\/config/);
    expect(md).toMatch(/Rerun affected checks and publish evidence/);
  });

  it('the Review flow repairs the closed list and names the finding outside it (single source)', () => {
    // BB-444: the repair step lives once in method-context › Review flow; the owners
    // reference the flow (asserted in the BB-209 merge test) and restate nothing.
    const flow = section(readSkill('method-context'), 'Review flow');
    expect(flow).toMatch(/[Rr]epair the closed list in this parent/);
    expect(flow).toMatch(/re-run the affected\s+checks/i);
    expect(flow).toMatch(/publish the new evidence/i);
    expect(flow).toMatch(/\*\*outside\*\*[\s\S]{0,40}named/i);
  });

  it('review-ticket states the negative half and references the single source', () => {
    const md = readSkill('review-ticket');
    expect(md).toMatch(/holds no credentials and performs\s*no repair/i);
    expect(md).toMatch(/Review's closed repair list/);
  });
});

describe('BB-444 item 6 — a fully specified ticket is created straight into coding', () => {
  it('to_coding accepts qualification as a from-state in all three work workflows', () => {
    const yml = read(WORKFLOWS_YML);
    for (const wf of ['bb_feature', 'bb_bug', 'bb_chore']) {
      const start = yml.indexOf(`${wf}:`);
      expect(start, `${wf} block not found`).toBeGreaterThan(-1);
      const next = yml.indexOf('\n\n', start);
      const block = next < 0 ? yml.slice(start) : yml.slice(start, next);
      const m = block.match(/to_coding:\s*\{[^}]*from:\s*\[([^\]]*)\]/);
      expect(m, `${wf} has no to_coding transition`).toBeTruthy();
      const from = (m?.[1] ?? '').split(',').map((s) => s.trim());
      expect(from, `${wf} to_coding from-states`).toContain('qualification');
    }
  });

  it('create-ticket states the shortcut condition, comment order, and the bug reproduction/diagnosis requirement', () => {
    const md = readSkill('create-ticket');
    expect(md).toMatch(
      /Only confirmed design, implementation plan and test plan/,
    );
    expect(md).toMatch(
      /bugs additionally\s+require reproduction and diagnosis/,
    );
    expect(md).toMatch(
      /Publish complete confirmed `spec`, `plan`, `test` comments/,
    );
    expect(md).toMatch(/use `coding` as the single destination/);
    expect(md).toMatch(/Otherwise retain normal routing/);
  });
});

describe("BB-444 item 7 — propose the branch's ticket as the parent", () => {
  it('create-ticket reads the branch, proposes parent_id, and yields to an explicit parent or rejection', () => {
    const md = readSkill('create-ticket');
    expect(md).toMatch(/explicit intake parent wins/);
    expect(md).toMatch(/ticket whose `branch_name` matches this\s+checkout/);
    expect(md).toMatch(/propose that parent/);
    expect(md).toMatch(/rejection means no parent/);
    expect(md).toMatch(/No matching ticket means no proposal/);
    expect(md).toMatch(
      /`base_branch` is computed from the parent; never write it/,
    );
    expect(md).toMatch(/Preserve explicit null conductor/);
  });
});

describe('BB-444 handoff+summary and method availability', () => {
  it('completion retains typed evidence and one summary with explicit domain exceptions', () => {
    const md = readSkill('workflow-step');
    expect(md).toMatch(/publish typed evidence and one aggregated `summary`/);
    expect(md).toMatch(/Summary-only exceptions/);
    expect(md).toMatch(/`pre_deployment`, `post_deployment`/);
    expect(md).toMatch(/`verifying` publishes per-ticket results/);
    expect(md).toMatch(/state write and readback → STOP/);
    expect(md).toMatch(/including blocked or state-restricted runs/);
    expect(md).toMatch(/On definite rejection retain state/);
    expect(md).toMatch(/on uncertain outcomes reconcile first/);
  });

  it('publish-comment confirms caller-authored content without choosing its type', () => {
    const md = bodyOf(readSkill('publish-comment'));
    expect(md).toContain('caller');
    expect(md).toContain('type and timing');
    expect(md).toContain('Check only the create response');
    expect(md).toContain('send no second create');
    expect(md).not.toContain('Conventional types:');
  });

  it('method-context offers every listed set, only the installed ones, first available as default', () => {
    const md = readSkill('method-context');
    expect(md).toMatch(/offer all\s+available sets with the first as default/);
    expect(md).toMatch(/unavailable choices and installation instructions/);
    expect(md).toMatch(
      /first available set; a pending answer is not a decline/,
    );
  });

  it('method-context gives concrete install steps and the restart caveat', () => {
    const md = readSkill('method-context');
    expect(md).toMatch(/using host discovery\/installation/);
    expect(md).toMatch(/unavailable required skill stops dependent\s+work/);
    expect(md).toMatch(/exact identifier and installation remedy/);
  });
});

describe('BB-444 skill-set selection blurbs', () => {
  it('each reference file carries a `> ` selection blurb', () => {
    for (const set of ['matt', 'superpowers'] as const) {
      const md = read(
        resolve(SKILLS_DIR, `method-context/references/${set}.md`),
      );
      expect(md, `${set}.md must carry a > blurb line`).toMatch(/^>\s+\*\*/m);
    }
    // the distinction the operator asked for is captured
    expect(
      read(resolve(SKILLS_DIR, 'method-context/references/superpowers.md')),
    ).toMatch(/cheaper model/i);
    expect(
      read(resolve(SKILLS_DIR, 'method-context/references/matt.md')),
    ).toMatch(/hard, under-specified/i);
  });

  it('method-context tells the question to show each set blurb', () => {
    const md = readSkill('method-context');
    expect(md).toMatch(/blockquote supplies the choice description/);
  });
});

describe('BB-444 read includes labels (method:*/work:* resolvable by name)', () => {
  it('read-ticket and the common preflight include labels, not only comments', () => {
    expect(readSkill('read-ticket')).toMatch(/--include comments,labels/);
    expect(readSkill('read-ticket')).toMatch(
      /name.*only readable[\s\S]{0,80}Included|Included/i,
    );
    expect(readSkill('workflow-step')).toMatch(
      /Read complete current-step context through `@bakers-build\/read-ticket`/i,
    );
  });
});

// BB-463: the `coding` step ends at a human confirmation gate. BB-424
// (4b337cfb) deleted that gate from all three coding owners and licensed the
// silent write in method-context; these assertions fail on that commit's text,
// which is the bar this check has to clear to be worth keeping.
describe('BB-463: coding transitions only on an explicit human choice', () => {
  const CODING_OWNERS = [
    'ddev-drupal-feature',
    'ddev-drupal-bug',
    'docs-authoring',
  ] as const;

  // The `## coding` section only, so a match in `## review` or in the preamble
  // cannot satisfy — or break — an assertion about coding.
  const section = (md: string, heading: string) => {
    const start = md.indexOf(`\n## ${heading}\n`);
    if (start === -1) return '';
    const rest = md.slice(start + 1);
    const next = rest.indexOf('\n## ', 1);
    return next === -1 ? rest : rest.slice(0, next);
  };

  it('method-context owns a Coding gate that stops the run', () => {
    const gate = section(readSkill('method-context'), 'Coding gate');
    expect(
      gate,
      'method-context must carry a `## Coding gate` section',
    ).not.toBe('');
    expect(gate, 'the gate takes the human confirmation').toMatch(/confirm/i);
    expect(gate, 'no explicit choice keeps the ticket in coding').toMatch(
      /remain in `coding`/,
    );
    // The load-bearing clause: without it a dispatched run applies
    // "An unattended run proceeds" from *Selecting the skill set* by analogy
    // and the regression returns.
    expect(gate, 'the gate states what an unattended run does').toMatch(
      /unattended/i,
    );
    // Observed on the fixture twice: the pointer to *Every transition leaves a
    // handoff and a summary* states its rule as "before a step transitions",
    // so a run stopping in `coding` read it as not applying and published the
    // handoff alone, leaving `summary_comment` empty. The gate has to say the
    // summary is owed with no transition, or the stop looks abandoned.
    expect(
      gate,
      'the gate owes a summary comment even when no transition follows',
    ).toMatch(/even when no transition follows/i);
  });

  it('the authorization boundary no longer licenses the coding transition', () => {
    const boundary = section(
      readSkill('method-context'),
      'Authorization and state boundary',
    );
    expect(boundary, 'the boundary names the coding exception').toMatch(
      /Apply the Coding gate before leaving coding/,
    );
    expect(boundary, 'the boundary points at the gate').toMatch(/Coding gate/);
  });

  for (const owner of CODING_OWNERS) {
    it(`${owner} defers its coding transition to the gate`, () => {
      const coding = section(readSkill(owner), 'coding');
      expect(coding, `${owner} must own a \`## coding\` section`).not.toBe('');
      expect(coding, `${owner} references the single-sourced gate`).toMatch(
        /`@bakers-build\/method-context` › \*Coding gate\*/,
      );
    });

    it(`${owner} states no transition to review of its own`, () => {
      const coding = section(readSkill(owner), 'coding');
      // BB-424's exact shape, in all three of its wordings:
      //   "transitions once through `@bakers-build/transition-ticket` to `review`"
      //   "transitions once to `review` under existing scope approval"
      expect(
        coding,
        `${owner} must not restate the transition the gate owns`,
      ).not.toMatch(/transitions? once[^.]*to `review`/);
    });
  }

  // The conditional exception to the gate above: a `coding` pass re-entered
  // from a `Not OK` verdict transitions on its own. The block above keeps the
  // first pass; these keep the exception. Both halves have to fail
  // independently, or one can regress behind the other's green.
  describe('the re-entry exception', () => {
    const gate = () => section(readSkill('method-context'), 'Coding gate');

    it('the gate carries a Re-entry exception', () => {
      expect(gate()).toMatch(/### Re-entry exception/);
    });

    it('the exception keys on the newest review verdict, not on "a review happened"', () => {
      const g = gate();
      expect(
        g,
        'the newest verdict decides, so an approved bounce reads as a first pass',
      ).toMatch(/newest/i);
      expect(g, 'the carrier is a comment of type `review`').toMatch(
        /type `review`/,
      );
      // The type alone cannot tell OK from Not OK — both publish as `review`.
      expect(g, 'the signal is the verdict line, not the comment type').toMatch(
        /Status: \*\*Not OK\*\*/,
      );
    });

    it('the exception requires GREEN', () => {
      expect(
        gate(),
        'a RED re-entry stops in coding as a first pass would',
      ).toMatch(/GREEN/);
    });

    it('a user restriction to coding still wins', () => {
      expect(gate()).toMatch(/restriction to `coding`/);
    });

    it('the exception states that an unattended re-entry transitions', () => {
      expect(gate()).toMatch(/unattended re-entry/i);
    });

    it('the exception transitions to review alone', () => {
      expect(gate()).toMatch(/`review`, and `review` alone/);
      expect(gate(), 'done stays behind explicit merge authorization').toMatch(
        /merge authorization/,
      );
    });

    it('step 2 reaches the exception instead of asking first', () => {
      // Without this clause a reader runs step 2, asks the question, and never
      // reaches the block that says not to.
      expect(gate()).toMatch(
        /Ask the human to confirm that summary and MR[\s\S]{0,120}Re-entry exception/,
      );
    });

    it('review flow pins the verdict line the exception reads', () => {
      const flow = section(readSkill('method-context'), 'Review flow');
      expect(flow).toMatch(/Status: \*\*OK\*\*/);
      expect(flow).toMatch(/Status: \*\*Not OK\*\*/);
      expect(flow, 'the verdict comment type').toMatch(/type `review`/);
    });

    it('the authorization boundary names the re-entry as authorized', () => {
      const boundary = section(
        readSkill('method-context'),
        'Authorization and state boundary',
      );
      expect(boundary).toMatch(/Apply the Coding gate before leaving coding/);
      expect(readSkill('method-context')).toMatch(/### Re-entry exception/);
    });

    it('no coding owner restates the exception', () => {
      for (const owner of CODING_OWNERS) {
        expect(
          section(readSkill(owner), 'coding'),
          `${owner} inherits the exception from the gate`,
        ).not.toMatch(/Re-entry exception|Status: \*\*Not OK\*\*/);
      }
    });
  });
});

describe('a cause per failing acceptance result', () => {
  // review-ticket owns the closed set; run-outtake owns how it renders and
  // method-context › Review flow owns what it routes to.
  it('review-ticket enumerates exactly three causes and closes the set', () => {
    const sec = section(readSkill('review-ticket'), 'The verdict');
    for (const cause of ['implementation', 'criterion', 'evidence']) {
      expect(sec, `the ${cause} cause must be named`).toMatch(
        new RegExp(`\`${cause}\``),
      );
    }
    expect(sec).toMatch(/closed:/i);
    expect(sec).toMatch(/fourth cause[\s\S]{0,80}defect/i);
  });

  it('a criterion cause owes a defect word and a proposed rewrite', () => {
    const sec = section(readSkill('review-ticket'), 'The verdict');
    for (const word of [
      'unsatisfiable',
      'ambiguous',
      'untestable',
      'out of scope',
    ]) {
      expect(sec, `the ${word} defect word must be named`).toContain(word);
    }
    expect(sec).toMatch(/proposes rewritten wording/i);
    expect(sec).toMatch(/omitted rewrite is a verdict defect/i);
  });

  it('classifying a cause does not widen what review may repair', () => {
    const sec = section(readSkill('review-ticket'), 'The verdict');
    expect(sec).toMatch(/classification/i);
    expect(sec).toMatch(/grants no additional repair authority/i);
    expect(sec).toMatch(/Review's closed repair list/);
  });
});

describe('the rendered result carries its cause', () => {
  // scoped to Input contract, the section that states the rule, not the whole
  // file — the worked Not OK example uses these same tokens and must not be
  // able to satisfy the rule on its own if the normative text regresses.
  it('run-outtake puts the cause at the result position, not at the line end', () => {
    const sec = read(
      resolve(SKILLS_DIR, 'method-context/references/results.md'),
    );
    expect(sec).toMatch(/FAIL\(<?cause>?\)|FAIL\(criterion\)/);
    expect(sec).toMatch(/result position/i);
  });

  it('an uncovered criterion renders FAIL(evidence) rather than a fourth cause', () => {
    const sec = read(
      resolve(SKILLS_DIR, 'method-context/references/results.md'),
    );
    expect(sec).toMatch(/uncovered/i);
    expect(sec).toMatch(/FAIL\(evidence\)/);
  });

  it('run-outtake points at review-ticket for the set rather than restating it', () => {
    const sec = read(
      resolve(SKILLS_DIR, 'method-context/references/results.md'),
    );
    expect(sec).toMatch(/@bakers-build\/review-ticket` › \*The verdict\*/);
  });
});

describe('review outtakes balance success and problems', () => {
  it('uses the shared format for both review verdicts', () => {
    const md = readSkill('run-outtake');
    expect(subsection(md, '🎯 Outcome')).toContain('`OK` or `Not OK`');
    expect(md).toContain('Omit empty optional sections');
  });

  it('retains complete review evidence in the typed handoff', () => {
    const md = readSkill('run-outtake');
    expect(md).toMatch(/Record each AC\x27s PASS\/FAIL\/RED\/PENDING/);
    expect(md).toMatch(/complete durable evidence in the\s+typed handoff/);
    expect(md).toMatch(/\*\*What \/ Why \/ Fix\*\*/);
    expect(md).toMatch(/success check/);
  });

  it('explains problems in detail and successes briefly', () => {
    const md = readSkill('run-outtake');
    expect(md).toMatch(/Success stays brief/);
    expect(md).toMatch(
      /expected versus observed\s+behavior, impact, evidence and required repair\/decision/,
    );
    expect(md).toMatch(/unknown causes honestly/);
    expect(md).toMatch(/proposed fixes from completed ones/);
    expect(md).toMatch(/criterion rewrites when supplied/);
  });
});

describe('a criterion cause does not take the coding route', () => {
  it('Review flow holds the run in review when any criterion cause is present', () => {
    const flow = section(readSkill('method-context'), 'Review flow');
    expect(flow).toMatch(/`criterion`/);
    expect(flow).toMatch(/(?:does not transition|no transition|hold)/i);
    expect(flow).toMatch(/any failing criterion/i);
  });

  it('a Not OK with no criterion cause still goes to coding', () => {
    const flow = section(readSkill('method-context'), 'Review flow');
    expect(flow).toMatch(/no `criterion`[\s\S]{0,120}`coding`/i);
  });

  it('the unattended stop points at the gate that already records the asymmetry', () => {
    const flow = section(readSkill('method-context'), 'Review flow');
    expect(flow).toMatch(/unattended/i);
    expect(flow).toMatch(/\*Coding gate\*/);
  });

  it('Review flow references the cause set rather than restating it', () => {
    const flow = section(readSkill('method-context'), 'Review flow');
    expect(flow).toMatch(/@bakers-build\/review-ticket` › \*The verdict\*/);
    // `criterion` is needed for routing; the other cause names stay owned by
    // review-ticket and must not be copied into Review flow.
    expect(flow).not.toMatch(/`implementation`|`evidence`/);
  });
});

describe('classifying a cause changes nothing about repair or the OK path', () => {
  it('the closed repair list still carries every clause it owned', () => {
    const md = readSkill('method-context');
    expect(md).toMatch(/linter\/formatter autofixes/);
    expect(md).toMatch(/Never behavior, tests or schema\/config/);
  });

  it('run-outtake still requires the complete list outside a Not OK verdict', () => {
    const md = readSkill('run-outtake');
    expect(md).toMatch(/Record each AC\x27s PASS\/FAIL\/RED\/PENDING/);
    expect(md).toMatch(/typed handoff/);
  });
});

describe('acceptance criteria are gated on quality, not only on shape', () => {
  const gate = () =>
    section(
      readSkill('acceptance'),
      'Gate each criterion before publishing it',
    );

  it('names the four defect words the review uses', () => {
    const sec = gate();
    for (const word of [
      'out of scope',
      'unsatisfiable',
      'ambiguous',
      'untestable',
    ]) {
      expect(sec, `the ${word} defect must be named`).toContain(word);
    }
  });

  it('points at the verdict for the word list rather than owning it', () => {
    // A second copy of the list is the failure mode: the copy that is not being
    // edited is the copy that goes stale, and then a review finding and the gate
    // that passed it stop naming the same thing.
    expect(gate()).toMatch(/@bakers-build\/review-ticket` › \*The verdict\*/);
  });

  it('gives every defect a worked failing example and its repair', () => {
    const md = readSkill('acceptance');
    expect(md).toMatch(/out of scope.*Narrow it/);
    expect(md).toMatch(/unsatisfiable.*Replace contradictions/);
    expect(md).toMatch(/ambiguous.*Specify input/);
    expect(md).toMatch(/untestable.*Name the observation/);
  });

  it('rewrites a failing criterion rather than blocking or flagging it', () => {
    const sec = gate();
    expect(sec).toMatch(/rewritt?en?/i);
    expect(sec).toMatch(/report/i);
  });

  it('leaves a criterion that passes exactly as written', () => {
    const md = readSkill('acceptance');
    expect(md).toMatch(/Preserve passing wording exactly/);
  });

  it('makes a rewrite name the assumption it rests on', () => {
    const md = readSkill('acceptance');
    expect(md).toMatch(/report the previous wording and any assumption/);
    expect(md).toMatch(
      /required\s+facts are missing, ask or record the unresolved assumption/,
    );
  });
});

describe('the qualification handoff shows what the gate did', () => {
  it('leads the acceptance bullets with the gate count', () => {
    const md = readSkill('qualify-ticket');
    expect(md).toMatch(/quality gate\x27s passed\/rewritten tally/);
    expect(md).toMatch(
      /Quality-gate approval is not a passed implementation test/,
    );
  });

  it('shows the replaced wording and any assumption the rewrite rested on', () => {
    const md = readSkill('qualify-ticket');
    expect(md).toMatch(
      /previous wording\s+for rewrites and explicit assumptions/,
    );
  });

  it('points at acceptance for the rules rather than restating them', () => {
    const md = readSkill('qualify-ticket');
    expect(md).toMatch(
      /@bakers-build\/acceptance` › \*Gate each criterion before\s+publishing it\*/,
    );
  });

  it('applies the gate before the handoff is published', () => {
    // Run flow step 5 is the write; gating after it would publish first and
    // repair afterwards.
    const flow = section(
      read(resolve(SKILLS_DIR, 'qualify-ticket/SKILL.md')),
      'Run flow',
    );
    expect(flow).toMatch(
      /@bakers-build\/acceptance` › \*Gate each criterion before\s+publishing it\*/,
    );
  });

  it('keeps the complete qualification handoff and delegates visible filtering', () => {
    const md = readSkill('qualify-ticket');
    expect(md).toMatch(/run-outtake` alone owns the visible summary/);
    expect(md).toMatch(/retain complete criteria in this typed record/);
  });
});

describe('the visible outtake filters acceptance detail', () => {
  it('keeps AC references with problems and omits passed ACs', () => {
    const md = readSkill('run-outtake');
    expect(md).toMatch(/failed, blocked or unresolved work, give AC IDs/);
    expect(md).toMatch(
      /Keep passed ACs in the typed handoff, not this summary/,
    );
  });
});

describe('the gate adds to the acceptance rules without replacing any', () => {
  // AC 6 read as a standing assertion rather than as a diff review: each of
  // these predates the gate and is deleted by exactly the kind of edit that
  // "tidies up while adding a section".
  const md = () => readSkill('acceptance');

  it('keeps the checkable-statement and per-sub-work standing rules', () => {
    const md = readSkill('acceptance');
    expect(md).toMatch(/condition another worker can mark met or not met/);
    expect(md).toMatch(
      /For each applicable `work:\*` sub-work, include one standing criterion/,
    );
    expect(md).toMatch(
      /bugs, also require that the reproducible condition no longer reproduces/,
    );
  });

  it('keeps exhaustiveness and the actor-and-benefit template', () => {
    const md = readSkill('acceptance');
    expect(md).toMatch(/Cover every implied condition/);
    expect(md).toMatch(/As an <actor>, I want <feature>, so that <benefit>/);
  });

  it('keeps the bug reproduction criterion and the PM-seeded rule', () => {
    expect(md()).toMatch(/no longer reproduces/);
    expect(md()).toMatch(/PM-seeded/);
  });

  it('keeps out_of_scope owned by the qualification handoff', () => {
    expect(readSkill('qualify-ticket')).toMatch(/`out_of_scope`/);
  });
});

describe('both qualification paths inherit the gate from one place', () => {
  it('create-ticket points at the acceptance template and copies no rule', () => {
    const md = readSkill('create-ticket');
    expect(md).toMatch(
      /every required field from\s+`@bakers-build\/qualify-ticket`/,
    );
  });
});

const REGISTER_OWNERS = [
  'create-spec',
  'docs-authoring',
  'diagnose-ticket',
  'ddev-drupal-bug',
  'ddev-drupal-feature',
];

describe('audience and register', () => {
  it("method-context reads the declaration from the operator's local file", () => {
    const md = readSkill('method-context');
    expect(md).toMatch(/^## Audience and register$/m);
    const sec = section(md, 'Audience and register');
    expect(sec).toMatch(/\.bakers\/audience\.local\.md/);
    // The value moved out of the repository entirely: a preference about how a
    // person wants to be addressed is not a fact the tree may assert for them.
    expect(sec).not.toMatch(/WORKFLOW\.md/);
    expect(sec, 'an absent file must still leave a defined register').toMatch(
      /developer-neutral/,
    );
  });

  it('the Audience and register section names no stack, product or vendor', () => {
    // The mechanism is bakers.build's and is loaded unchanged by every project, so a stack
    // word here would tell one operator they know another project's tools. Scoped to
    // the section: a skill identifier elsewhere in the file (`@bakers-build/provision-ddev`)
    // is a reference, not a vocabulary leak.
    expect(
      section(readSkill('method-context'), 'Audience and register'),
    ).not.toMatch(/\b(Drupal|Drush|DDEV|Views|PHPUnit|Twig|ponytail)\b/i);
  });

  it('the WORKFLOW.md section map carries no Audience row', () => {
    // That table maps sections of WORKFLOW.md, and the declaration is no longer one.
    const md = readSkill('method-context');
    expect(md.slice(0, md.search(/^## /m))).not.toMatch(/\| Audience \|/);
  });

  it('neither the project nor the template declares an audience', () => {
    // Inverted on purpose. Presence assertions cannot stop the section being
    // reinstated by habit; these fail the moment a repository decides for its readers.
    expect(read(WORKFLOW_MD)).not.toMatch(/^## Audience$/m);
    expect(
      read(
        resolve(
          REPO_ROOT,
          '.claude/skills/bakers-build/templates/WORKFLOW.template.md',
        ),
      ),
    ).not.toMatch(/^## Audience$/m);
  });

  it('the operator file is ignored and documented', () => {
    // An uncommitted file is undiscoverable unless something tracked names it, and
    // useless unless git is told to leave it alone. Both live outside the skill tree.
    expect(read(resolve(REPO_ROOT, '.gitignore'))).toMatch(
      /^\/\.bakers\/audience\.local\.md$/m,
    );
    expect(read(resolve(REPO_ROOT, '.bakers/README.md'))).toMatch(
      /audience\.local\.md/,
    );
  });

  it('a fresh worktree inherits the operator file', () => {
    // A dispatched run works in a worktree, not in this clone, so without the copy
    // every conductor run would silently fall back to the neutral default.
    expect(read(resolve(REPO_ROOT, '.ddev/worktree-post.sh'))).toMatch(
      /audience\.local\.md/,
    );
  });

  it('every code-state owner references the register without restating it', () => {
    for (const name of REGISTER_OWNERS) {
      const md = readSkill(name);
      expect(md, `${name} must reference the shared context`).toMatch(
        /@bakers-build\/method-context/,
      );
      // The rule lives in method-context once; the owners carry a reference, not a copy.
      expect(md, `${name} must not restate the rule`).not.toMatch(
        /never explained|assumed known/i,
      );
    }
  });
});

describe('run-outtake carries the register consequence', () => {
  it('points at the rule rather than restating it', () => {
    expect(readSkill('run-outtake')).toMatch(/Audience and register/);
  });

  it('states what brevity may never remove', () => {
    const md = readSkill('run-outtake');
    expect(md).toMatch(/Complete evidence stays in the typed handoff/i);
    expect(md).toMatch(/complete[\s\S]{0,40}acceptance/i);
  });
});

describe('review has a second, non-blocking axis', () => {
  it('review-ticket carries the over-engineering pass', () => {
    expect(readSkill('review-ticket')).toMatch(/^## Over-engineering pass$/m);
  });

  it('the pass cannot by itself force Not OK', () => {
    const pass = section(readSkill('review-ticket'), 'Over-engineering pass');
    expect(pass).toMatch(/alone do not change the verdict to `Not OK`/i);
  });

  it('the pass attributes its MIT provenance', () => {
    expect(
      section(readSkill('review-ticket'), 'Over-engineering pass'),
    ).toMatch(/MIT/);
  });
});

describe('run-outtake destinations and the print-before-confirm chain', () => {
  it('names the terminal and the summary as destinations of the same text, forbids a separate recap, and prints before any question including a stop without one', () => {
    // Raw file: expanding the Input contract inlines results.md, whose H2s would
    // truncate this section before the destination sentences.
    const contract = section(
      read(resolve(SKILLS_DIR, 'run-outtake', 'SKILL.md')),
      'Input contract',
    );
    expect(contract).toMatch(/two destinations/);
    expect(contract).toMatch(/ticket's `summary`/);
    expect(contract).toMatch(/Publishing is not presenting/);
    expect(contract).toMatch(/No separate recap in another format/i);
    expect(contract).toMatch(/stops without a question/);

    expect(readSkill('workflow-step')).toMatch(
      /aggregated `summary`\s*→\s*print it[\s\S]*?required\s+confirmation/,
    );

    const codingGate = section(readSkill('method-context'), 'Coding gate');
    expect(codingGate).toMatch(
      /publish\s+\*\*both\*\*[\s\S]*?print that summary in full in the terminal[\s\S]*?`@bakers-build\/run-outtake` › \*Input contract\*/,
    );
    expect(codingGate).toMatch(
      /\*\*Ask the human to confirm that summary and MR\*\*/,
    );

    const reviewFlow = section(readSkill('method-context'), 'Review flow');
    expect(reviewFlow).toMatch(
      /render once[\s\S]*?[Pp]rint it in full in the terminal[\s\S]*?Take the human's confirmation of the verdict/,
    );
    expect(reviewFlow).not.toMatch(/Print the published summary/);
  });
});

describe('BB-681 configure-tunnel-project skill is retired, not replaced', () => {
  it('ships no configure-tunnel-project skill', () => {
    expect(existsSync(resolve(SKILLS_DIR, 'configure-tunnel-project'))).toBe(
      false,
    );
  });

  it('existing ports instructions use service keys and bakers ports status, not old file/PID semantics or the retired skill', () => {
    const essential = read(resolve(SKILLS_DIR, 'essential-skills', 'SKILL.md'));
    expect(essential).toMatch(
      /bakers ports up <service-key>|bakers ports up <service/,
    );
    expect(essential).not.toMatch(/bakers ports up <port>/);
    expect(essential).not.toMatch(/configure-tunnel-project/);

    const actors = read(
      resolve(SKILLS_DIR, 'provision-ddev', 'references', 'actors.md'),
    );
    expect(actors).toMatch(/bakers ports status/);
    expect(actors).not.toMatch(/ports-tunnels\.json/);
  });
});

describe('remote prior-art lifecycle boundaries', () => {
  const raw = (name: string) => read(resolve(SKILLS_DIR, name));
  it('checks the remote base before qualification publication', () => {
    const flow = raw('qualify-ticket/SKILL.md');
    expect(flow).toMatch(
      /prior-art-search\.md[\s\S]*prior-art-build\.md[\s\S]*Publish one complete/,
    );
    expect(flow).toContain('prior_art_hit');
    expect(flow).toContain('both ticket-search and base-check evidence');
    expect(flow).toMatch(
      /ticket searches, and its probe when a search is empty, before any Git call/,
    );
    expect(flow).not.toContain("depends on step 1's outcome");
  });
  it('gates direct merges with fresh evidence after forge preconditions', () => {
    const flow = raw('merge-mr/SKILL.md');
    expect(flow).toMatch(
      /Pipeline green[\s\S]*prior-art-build\.md[\s\S]*glab mr merge/,
    );
    for (const term of [
      'target mismatch',
      'prior_art_hit',
      'not_run',
      'check evidence',
    ])
      expect(flow).toContain(term);
  });
  it('publishes the returned merge evidence in both credentialed callers', () => {
    for (const name of ['coding', 'review']) {
      const flow = raw(`method-context/references/${name}.md`);
      expect(flow).toMatch(
        /@bakers-build\/merge-mr[\s\S]*including its \*Caller handoff\*[\s\S]*transition/,
      );
      expect(flow).not.toContain('### Merge check handoff');
    }
    expect(raw('merge-mr/SKILL.md')).toMatch(
      /## Caller handoff[\s\S]*Before any final transition[\s\S]*returned check evidence[\s\S]*summary/,
    );
  });
  it('defines evidence and candidate interpretation once', () => {
    const flow = raw('method-context/references/prior-art-build.md');
    for (const term of [
      'qualification',
      'merge',
      'checked revision',
      'path scope',
      'not_run',
      'reverted',
      'own ticket',
    ])
      expect(flow).toContain(term);
    expect(section(flow, 'Check evidence')).toMatch(
      /`negative`, `prior_art_hit` and `error` each report[\s\S]*full checked revision when resolved before any error[\s\S]*`not_run` reports only the checkpoint/,
    );
    expect(
      JSON.parse(read(resolve(SKILLS_DIR, '../.claude-plugin/plugin.json')))
        .version,
    ).not.toBe('0.39.11');
  });
});
