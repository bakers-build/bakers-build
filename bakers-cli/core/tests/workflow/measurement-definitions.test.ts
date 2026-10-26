import { readdirSync, readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

const measurements = new URL(
  '../../../../.claude/skills/bakers-build/skills/bb-review-ticket/measurements/',
  import.meta.url,
);
const read = (path: string) =>
  JSON.parse(readFileSync(new URL(path, measurements), 'utf8'));
const validate = new Ajv2020({ allErrors: true }).compile(read('schema.json'));
const definitions = readdirSync(new URL('definitions/', measurements))
  .filter((file) => file.endsWith('.json'))
  .sort();

describe('shipped measurement definitions', () => {
  it.each(definitions)('%s conforms to the published schema', (file) => {
    const definition = read(`definitions/${file}`);
    expect(validate(definition), JSON.stringify(validate.errors)).toBe(true);
    const names = definition.values.map(
      (value: { name: string }) => value.name,
    );
    expect(new Set(names).size).toBe(names.length);
  });

  it('offers the five human job ratings with no unrated zero', () => {
    const definition = read('definitions/job-rating.json');
    expect(definition).toMatchObject({
      id: 'job_rating',
      label: 'Job Rating',
      label_term: 'retro',
      values: [{ name: 'score', min: 1, max: 5, direction: 'up' }],
    });
    expect(definition.values).toHaveLength(1);
    for (const level of [
      '5 — Excellent: delivered what I wanted; nothing to correct.',
      '4 — Good: minor corrections only; no rework.',
      '3 — Flawed: usable, but it cost me effort it should not have.',
      '2 — Poor: substantial rework, or pieces missing.',
      '1 — Unusable: I would have been faster doing it myself.',
    ]) {
      expect(definition.values[0].description).toContain(level);
    }
  });

  it('measures merge-request size in changed lines with file and line counts', () => {
    const definition = read('definitions/mr-changes.json');
    expect(definition).toMatchObject({ id: 'mr_changes', label: 'MR Changes' });
    expect(definition).not.toHaveProperty('label_term');
    expect(
      definition.values.map((value: { name: string; unit: string }) => [
        value.name,
        value.unit,
      ]),
    ).toEqual([
      ['score', 'lines'],
      ['files_changed', 'count'],
      ['additions', 'lines'],
      ['deletions', 'lines'],
    ]);
    for (const value of definition.values) {
      expect(value).toMatchObject({ min: 0, direction: 'neutral' });
    }
    expect(definition.values[0].description).toContain(
      'git diff --numstat -M origin/<base_branch>...HEAD',
    );
    expect(definition.values[0].description).toContain('additions + deletions');
  });
});
