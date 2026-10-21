import { expect, it } from 'vitest';
import { TICKET_SECTIONS } from '../../../../../src/Entity/ticket/Component/sections/index.js';

// BB-346 — this file used to describe a tab BAR. The bar is the top bar's job
// now (`Component/top-tabs`, `Kernel/chrome.ts`), and what is left here is the
// only part that was ever ticket knowledge: which document sections each section
// groups, and in which order it lists them.
//
// The cases about the bar's nodes, its click routing and its inert joins are not
// dropped — they moved with the bar. `tests/Component/top-tabs/index.test.ts`
// asserts one clickable part per tab, `tests/Kernel/chrome.test.ts` asserts that
// a press resolves to the tab under the pointer and that the joins and the row
// itself are inert, and `tests-bun/Kernel/ticket-sections.test.ts` clicks real
// terminal columns on a real renderer.
//
// BB-516: the Relationships sub-tab was removed; its `related` section data is
// retained in TICKET_SECTIONS because the Overview sidebar still reads it, but it
// no longer corresponds 1:1 with the registry tabs.

it('TICKET_SECTIONS includes overview, planning, comments, related (sidebar) and runs', () => {
  expect(TICKET_SECTIONS.map((s) => s.id)).toEqual([
    'overview',
    'planning',
    'comments',
    'related',
    'runs',
  ]);
});

it('Overview lists parent and links FIRST, then the description', () => {
  const byId = Object.fromEntries(TICKET_SECTIONS.map((s) => [s.id, s]));
  // BB-255 AC-3/D3: this array is what puts both above the fold, and nothing
  // else does. BB-233 keeps `Assignment` after `Description`; BB-308 puts
  // `Time` directly after `Assignment` — a section no entry lists is invisible.
  // BB-369 D3/D4: `Latest summary` goes BETWEEN `Links` and `Description`.
  // BB-381 D3: `Latest spec` then `Latest plan` between summary and Description
  // — presence is decided by `detailSections` conditional push; this array only
  // names the slots Overview may show.
  expect(byId.overview?.headings).toEqual([
    'Source',
    'Parent',
    'Links',
    'Latest summary',
    'Latest spec',
    'Latest plan',
    'Description',
    'Assignment',
    'Pending reviews',
    'Time',
    'Branch',
    'Environments',
  ]);
});

it('Related lists the parent too, and Planning, Comments and Runs list nothing', () => {
  const byId = Object.fromEntries(TICKET_SECTIONS.map((s) => [s.id, s]));
  // BB-255 AC-5: the same section on two tabs falls out of `sectionsForTab`'s
  // heading lookup and needs no mechanism.
  // BB-369 D5: `Blocked by` joined between `Sub-tickets` and
  // `Referenced tickets`, and is the only one of the three rendered as identity
  // rows rather than a count.
  expect(byId.related?.headings).toEqual([
    'Source',
    'Parent',
    'Sub-tickets',
    'Blocked by',
    'Referenced tickets',
  ]);
  // Planning/Comments/Runs have their own view functions, so none lists headings.
  expect(byId.planning?.headings).toEqual([]);
  expect(byId.comments?.headings).toEqual([]);
  expect(byId.runs?.headings).toEqual([]);
});
