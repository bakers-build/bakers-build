import { describe, expect, it } from 'vitest';
import { urlRuns } from '../../src/lib/hyperlink.js';

// BB-326 — which stretches of a COMPOSED LINE are addresses.
//
// The cockpit composes strings and the kernel turns each one into cells, so a
// hyperlink can only ever be "this range of this line points at that URL". The
// whole risk therefore lives here: a scanner that is too eager mangles ordinary
// text into a link, and one that trims wrongly produces a link that goes
// somewhere else than it reads. So the rules are narrow and each one is a case
// below:
//
//   * only `http://` and `https://` — never a bare host, never `www.`, never
//     another scheme. A `state: coding` or a `feat/bb-326` must be untouched;
//   * the run ends at whitespace, because a composed row is padded with spaces
//     and may carry another column after the URL;
//   * trailing sentence punctuation and an unbalanced closing bracket are NOT
//     part of the address — prose puts them there, the URL does not;
//   * a run the frame TRUNCATED is not a link at all. `fitLine` appends `…`,
//     and linking `https://bakers.example.test/very/lo` because that is what fit
//     on screen would send the operator somewhere that is not the ticket.

const urls = (line: string) => urlRuns(line).map((run) => run.url);
const texts = (line: string) =>
  urlRuns(line).map((run) => line.slice(run.start, run.end));

describe('urlRuns', () => {
  it('finds an http(s) address and reports exactly its range', () => {
    const line = 'open https://example.test/a/b now';
    expect(urlRuns(line)).toEqual([
      { start: 5, end: 29, url: 'https://example.test/a/b' },
    ]);
    expect(line.slice(5, 29)).toBe('https://example.test/a/b');
  });

  it('reports the range and the url as the SAME text, always', () => {
    // The one invariant that makes a link honest: what the operator reads is
    // what they get. Nothing here may rewrite, normalise or complete a URL.
    const line = 'a https://example.test/x, b http://example.test/y.';
    expect(texts(line)).toEqual(urls(line));
  });

  it('leaves the sentence punctuation after an address out of it', () => {
    expect(urls('see https://example.test/a.')).toEqual([
      'https://example.test/a',
    ]);
    expect(urls('see https://example.test/a, and')).toEqual([
      'https://example.test/a',
    ]);
    expect(urls('see https://example.test/a; ok')).toEqual([
      'https://example.test/a',
    ]);
  });

  it('does not swallow a closing bracket the prose opened', () => {
    expect(urls('(https://example.test/a)')).toEqual([
      'https://example.test/a',
    ]);
    expect(urls('[https://example.test/a]')).toEqual([
      'https://example.test/a',
    ]);
  });

  it('keeps a closing bracket the URL itself opened', () => {
    // Wikipedia-shaped paths really do carry balanced parentheses.
    expect(urls('https://example.test/a_(b)')).toEqual([
      'https://example.test/a_(b)',
    ]);
  });

  it('finds every address on the line', () => {
    expect(urls('https://a.test/1 and http://b.test/2')).toEqual([
      'https://a.test/1',
      'http://b.test/2',
    ]);
  });

  it('never links anything that is not an http(s) address', () => {
    for (const line of [
      'BB-326 · state: coding · feat/bb-326-migrate',
      'no scheme here: example.test/a',
      'www.example.test',
      'ftp://example.test/a',
      'file:///etc/passwd',
      'a//b://c',
      '',
    ])
      expect(urls(line)).toEqual([]);
  });

  it('never links a TRUNCATED address — `fitLine`’s ellipsis ends the run', () => {
    // What a too-narrow terminal actually produces. Linking this would offer a
    // tap that goes to `…/very/lo`, which is not the ticket.
    expect(urls('https://bakers.example.test/very/lo…')).toEqual([]);
    // …but an ellipsis after a SPACE truncated something else, not the URL.
    expect(urls('https://a.test/1 and something el…')).toEqual([
      'https://a.test/1',
    ]);
  });

  it('stops at whitespace, because a composed row is padded with spaces', () => {
    expect(urls('https://a.test/1                 ')).toEqual([
      'https://a.test/1',
    ]);
  });

  it('is empty for a line with no scheme at all, without scanning it', () => {
    // Cheapness matters: this runs on every composed line of every frame.
    expect(urlRuns('IDENTIFIER STATE PRIO WHO RUN PARENT COND TITLE')).toEqual(
      [],
    );
  });
});
