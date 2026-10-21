import { describe, expect, it } from 'vitest';
import { clipboardStatus } from '../../src/lib/clipboard.js';

// BB-326 — a copy the operator cannot see is indistinguishable from one that
// failed, so every outcome the OSC 52 seam can produce has to have a WORDING,
// and no wording may claim more than the outcome does.
//
// The four outcomes are not a taxonomy for its own sake: `@opentui/core@0.5.1`
// probes the terminal and reports `supported | unknown | unsupported`, and
// `Clipboard.copyToClipboardOSC52` refuses on `unsupported` only — so an
// `unknown` terminal DOES get the escape, unconfirmed. Collapsing those two into
// "copied" would be the exact lie this file exists to prevent.

describe('clipboardStatus', () => {
  it('states what went into the clipboard when the terminal confirmed OSC 52', () => {
    expect(clipboardStatus('copied', 'BB-326')).toBe('copied BB-326');
  });

  it('says the copy is UNCONFIRMED when the terminal never answered the probe', () => {
    const status = clipboardStatus('unconfirmed', 'BB-326');
    expect(status).toContain('BB-326');
    expect(status).toContain('OSC 52');
    // It must not read as a plain success…
    expect(status).not.toBe('copied BB-326');
    // …and it must not read as a failure either: the escape really was sent.
    expect(status).not.toContain('not copied');
  });

  it('never claims a copy happened on a terminal that refuses OSC 52', () => {
    const status = clipboardStatus('unsupported', 'BB-326');
    expect(status).toContain('not copied');
    expect(status).toContain('OSC 52');
  });

  it('never claims a copy happened when the write itself failed', () => {
    expect(clipboardStatus('failed', 'BB-326')).toContain('not copied');
  });

  it('carries the label verbatim, so the operator can see WHICH thing was copied', () => {
    expect(clipboardStatus('copied', 'the link to BB-1')).toBe(
      'copied the link to BB-1',
    );
  });
});
