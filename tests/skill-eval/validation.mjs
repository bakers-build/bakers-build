export const nonempty = value => typeof value === 'string' && value.trim().length > 0;
export const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
export const slug = value => typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);

// A unit is a skill (its SKILL.md) or one frame reference, applied with the frame as context.
export const reference = value => typeof value === 'string' && /^bb-workflow\/references\/[a-z0-9/-]+\.md$/.test(value);
export const sourcePaths = fixture => reference(fixture.skill)
  ? ['bb-workflow/SKILL.md', fixture.skill, ...fixture.references] : [`${fixture.skill}/SKILL.md`, ...fixture.references];

export function validateEnvelope(fixture) {
  requireValue(fixture?.synthetic === true && slug(fixture.id) && (slug(fixture.skill) || reference(fixture.skill)),
    'Expected a named synthetic skill fixture');
  requireValue(fixture.execution === undefined || fixture.execution === 'simulated-tools', 'Unsupported fixture execution mode');
  requireValue(fixture.input && typeof fixture.input === 'object' && !Array.isArray(fixture.input), 'Expected fixture input');
  requireValue(Array.isArray(fixture.references) && new Set(fixture.references).size === fixture.references.length &&
    fixture.references.every(path => typeof path === 'string' && /^[a-zA-Z0-9_/-]+\.md$/.test(path) &&
      !path.startsWith('/') && !path.split('/').includes('..') && sourcePaths({ ...fixture, references: [] }).every(s => s !== path)),
  'References must be unique relative Markdown paths beneath the skills directory');
  requireValue(Array.isArray(fixture.rubric) && fixture.rubric.length > 0 &&
    new Set(fixture.rubric.map(c => c.id)).size === fixture.rubric.length &&
    fixture.rubric.every(c => slug(c.id) && nonempty(c.criterion)), 'Expected a complete named semantic rubric');
}

// Recipes are installed skills the frame resolves; frame and slot tests install test recipes, a classify case installs shipped ones by name to pin their descriptions.
export const recipeName = value => typeof value === 'string' && /^bb-recipe-[a-z0-9-]+$/.test(value);
