import { describe, expect, it } from 'vitest';
import { TICKET_SECTIONS } from '../../../../../src/Entity/ticket/Component/sections/index.js';
import {
  detailSections,
  sectionsForTab,
} from '../../../../../src/Entity/ticket/Component/ticket-detail/index.js';
import type { TicketDetailDocument } from '../../../../../src/types.js';

const doc = (attributes: Record<string, unknown>): TicketDetailDocument =>
  ({ data: { id: 't1', attributes } }) as unknown as TicketDetailDocument;

const timeLines = (attributes: Record<string, unknown>): string[] =>
  detailSections(doc(attributes)).find((s) => s.heading === 'Time')?.lines ??
  [];

describe('the Time section', () => {
  it('renders both values as human durations', () => {
    const lines = timeLines({ time_estimate: 14_400, time_spent: 39_600 });
    expect(lines.join('\n')).toContain('4h');
    expect(lines.join('\n')).toContain('11h');
  });

  it('names the difference as an overrun when spent exceeds the estimate', () => {
    const lines = timeLines({ time_estimate: 14_400, time_spent: 39_600 });
    expect(lines.join('\n')).toContain('over');
    expect(lines.join('\n')).toContain('7h');
  });

  it('names the difference as remaining when spent is under the estimate', () => {
    const lines = timeLines({ time_estimate: 14_400, time_spent: 3600 });
    expect(lines.join('\n')).toContain('left');
  });

  it('states an explicit empty state when neither value is set', () => {
    expect(timeLines({}).join('\n')).toContain('No estimate');
  });

  it('omits the difference when only one of the two is set', () => {
    const lines = timeLines({ time_estimate: 14_400 }).join('\n');
    expect(lines).toContain('4h');
    expect(lines).not.toContain('over');
    expect(lines).not.toContain('left');
  });

  // The section is only reachable in the TTY rendering if a tab claims its
  // heading — `sectionsForTab` filters by `TICKET_SECTIONS[i].headings`. A section
  // no tab lists still shows in the flat `bakers ui BB-308 | cat` render, so a
  // detailSections-only test would pass while the interactive screen lost it.
  it('is claimed by the same tab that carries Assignment', () => {
    const overview = TICKET_SECTIONS.findIndex((t) =>
      t.headings.includes('Assignment'),
    );
    expect(overview).toBeGreaterThanOrEqual(0);
    const headings = sectionsForTab(
      doc({ time_estimate: 14_400, time_spent: 39_600 }),
      overview,
    ).map((s) => s.heading);
    expect(headings).toContain('Time');
  });
});
