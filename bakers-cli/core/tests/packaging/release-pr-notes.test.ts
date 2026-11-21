import { expect, it } from 'vitest';
import { prSections } from '../../../scripts/release-pr-notes.mjs';

const body = [
  '## Summary',
  'x',
  '### Upgrade notes',
  'Run drush updb.',
  '#### Detail',
  'd',
  '### Batch',
  'b',
  '### Known open issues',
  '- slow list',
  '## Footer',
  'f',
].join('\n');

it('keeps both sections verbatim and drops the others', () => {
  expect(prSections(body)).toBe(
    '### Upgrade notes\nRun drush updb.\n#### Detail\nd\n\n### Known open issues\n- slow list',
  );
});

it('returns one section when the other is missing', () => {
  expect(prSections('## Summary\nx\n### Known open issues\n- slow list\n### Batch\nb')).toBe(
    '### Known open issues\n- slow list',
  );
});

it('returns empty string for no sections and for null', () => {
  expect(prSections('## Summary\nx\n### Batch\nb')).toBe('');
  expect(prSections(null)).toBe('');
});

it('finds sections in a CRLF body', () => {
  expect(prSections(body.replaceAll('\n', '\r\n'))).toBe(prSections(body));
});

it('keeps headings inside a code fence within the section', () => {
  expect(
    prSections('### Upgrade notes\n```md\n## not a heading\n### Batch\n```\nafter\n### Batch\nb'),
  ).toBe('### Upgrade notes\n```md\n## not a heading\n### Batch\n```\nafter');
});

it('runs a last section to the end and trims trailing blank lines', () => {
  expect(prSections('## Summary\nx\n### Upgrade notes  \nRun it.\n\n\n')).toBe(
    '### Upgrade notes  \nRun it.',
  );
});

it('matches the heading case-insensitively and outputs in fixed order', () => {
  expect(prSections('### known open issues\nk\n### UPGRADE NOTES\nu')).toBe(
    '### UPGRADE NOTES\nu\n\n### known open issues\nk',
  );
});
