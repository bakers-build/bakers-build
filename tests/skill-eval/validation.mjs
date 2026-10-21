export const nonempty = value => typeof value === 'string' && value.trim().length > 0;
export const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
export const slug = value => typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);

export function validateEnvelope(fixture) {
  requireValue(fixture?.synthetic === true && slug(fixture.id) && slug(fixture.skill),
    'Expected a named synthetic skill fixture');
  requireValue(fixture.execution === undefined || fixture.execution === 'simulated-tools', 'Unsupported fixture execution mode');
  requireValue(fixture.input && typeof fixture.input === 'object' && !Array.isArray(fixture.input), 'Expected fixture input');
  requireValue(Array.isArray(fixture.references) && new Set(fixture.references).size === fixture.references.length &&
    fixture.references.every(path => typeof path === 'string' && /^[a-zA-Z0-9_/-]+\.md$/.test(path) &&
      !path.startsWith('/') && !path.split('/').includes('..') && path !== `${fixture.skill}/SKILL.md`),
  'References must be unique relative Markdown paths beneath the skills directory');
  requireValue(Array.isArray(fixture.rubric) && fixture.rubric.length > 0 &&
    new Set(fixture.rubric.map(c => c.id)).size === fixture.rubric.length &&
    fixture.rubric.every(c => slug(c.id) && nonempty(c.criterion)), 'Expected a complete named semantic rubric');
}
