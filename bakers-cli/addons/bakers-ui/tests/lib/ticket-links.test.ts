import { describe, expect, it } from 'vitest';
import {
  isPullRequest,
  linkLabel,
  ticketTopLinks,
} from '../../src/lib/ticket-links.js';
import type { TicketDetailDocument } from '../../src/types.js';

const ticket = (
  attributes: Record<string, unknown>,
  id = 'uuid-1',
): TicketDetailDocument => ({
  data: { id, type: 'bb_ticket--bb_ticket', attributes },
});

describe('linkLabel', () => {
  it('labels a GitHub pull request by number', () => {
    expect(linkLabel('https://github.com/o/r/pull/229')).toBe('PR #229');
    expect(linkLabel('https://github.com/o/r/pull/229/')).toBe('PR #229');
    expect(linkLabel('https://github.com/o/r/pull/229#x')).toBe('PR #229');
  });

  it('labels a GitLab merge request by number', () => {
    expect(linkLabel('https://gitlab.test/g/p/-/merge_requests/12')).toBe(
      'MR !12',
    );
  });

  it('shortens any other URL to host and last path segment', () => {
    expect(linkLabel('https://example.test/a/b/result')).toBe(
      'example.test/…/result',
    );
    expect(linkLabel('https://example.test/result')).toBe(
      'example.test/result',
    );
    expect(linkLabel('https://example.test')).toBe('example.test');
  });

  it('caps a long label at 40 characters', () => {
    const label = linkLabel(`https://example.test/a/${'x'.repeat(80)}`);
    expect(label).toHaveLength(40);
    expect(label.endsWith('…')).toBe(true);
  });

  it('labels a value without a web host as link', () => {
    expect(linkLabel('legacy-tracker#16')).toBe('link');
    expect(linkLabel('internal:/node/1')).toBe('link');
    expect(linkLabel('mailto:a@b.test')).toBe('link');
  });
});

describe('isPullRequest', () => {
  it('recognises PR and MR URLs and titles', () => {
    expect(isPullRequest('', 'https://github.com/o/r/pull/1')).toBe(true);
    expect(isPullRequest('', 'https://g.test/-/merge_requests/2')).toBe(true);
    expect(isPullRequest('PR', 'https://ci.test/x')).toBe(true);
    expect(isPullRequest('Merge request', 'https://ci.test/x')).toBe(true);
    expect(isPullRequest('Result', 'https://example.test/r')).toBe(false);
    expect(isPullRequest('Preview', 'https://example.test/r')).toBe(false);
  });
});

describe('ticketTopLinks', () => {
  const doc = ticket({
    identifier: 'BAKERS-332',
    links: [
      { title: 'Result', uri: 'https://example.test/a/b/result' },
      { title: 'PR', uri: 'https://github.com/o/r/pull/229' },
    ],
  });

  it('orders the ticket URL first, then pull requests, then other links', () => {
    const links = ticketTopLinks(doc, 'https://b.test/');
    expect(links.map((link) => link.key)).toEqual(['ticket', 'PR', 'Result']);
    expect(links.map((link) => link.label)).toEqual([
      'BAKERS-332',
      'PR #229',
      'example.test/…/result',
    ]);
    expect(links[0]?.href).toBe('https://b.test/admin/bakers/ticket/uuid-1');
    expect(links[1]?.href).toBe('https://github.com/o/r/pull/229');
  });

  it('keeps several pull requests first in stored order', () => {
    const links = ticketTopLinks(
      ticket({
        links: [
          { title: 'Docs', url: 'https://example.test/docs' },
          { title: 'PR', uri: 'https://github.com/o/r/pull/1' },
          { title: 'MR', uri: 'https://g.test/-/merge_requests/2' },
        ],
      }),
    );
    expect(links.map((link) => link.label)).toEqual([
      'PR #1',
      'MR !2',
      'example.test/docs',
    ]);
  });

  it('leaves the ticket row out without a base URL', () => {
    expect(ticketTopLinks(doc).map((link) => link.key)).toEqual([
      'PR',
      'Result',
    ]);
  });

  it('returns only the ticket row for a linkless ticket', () => {
    const links = ticketTopLinks(
      ticket({ identifier: 'BAKERS-1', links: [] }),
      'https://b.test',
    );
    expect(links).toEqual([
      {
        key: 'ticket',
        label: 'BAKERS-1',
        href: 'https://b.test/admin/bakers/ticket/uuid-1',
        pullRequest: false,
      },
    ]);
  });

  it('labels an untitled link as link and keeps its href', () => {
    const links = ticketTopLinks(
      ticket({ links: [{ uri: 'https://example.test/x' }] }),
    );
    expect(links).toEqual([
      {
        key: 'link',
        label: 'example.test/x',
        href: 'https://example.test/x',
        pullRequest: false,
      },
    ]);
  });
});
