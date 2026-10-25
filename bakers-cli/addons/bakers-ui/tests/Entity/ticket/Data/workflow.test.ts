import { expect, it } from 'vitest';
import {
  WORKFLOW_KINDS,
  WORKFLOW_OPTIONS,
} from '../../../../src/Entity/ticket/Data/workflow.js';

// BB-236 phase 4 (AC-21) merged the workflow classification into ONE
// declaration; BB-299 D2 then removed the filter consumer — the `t type`
// filter is gone, so `TYPE_FILTER_VALUES`/`TYPE_LABELS` are deleted rather
// than orphaned. What remains (`WORKFLOW_KINDS`/`WORKFLOW_OPTIONS`) has
// exactly one consumer: the create form's workflow picker (spec F3).

it('exposes no TYPE_* filter exports (BB-299 D2)', async () => {
  const mod = await import('../../../../src/Entity/ticket/Data/workflow.js');
  expect('TYPE_FILTER_VALUES' in mod).toBe(false);
  expect('TYPE_LABELS' in mod).toBe(false);
});

it('carries exactly the one bakers.build work workflow (BAKERS-17)', () => {
  expect(WORKFLOW_KINDS.map((k) => k.id)).toEqual(['bb_work']);
  expect(WORKFLOW_KINDS.map((k) => k.label)).toEqual(['work']);
});

it('WORKFLOW_OPTIONS mirrors the kinds, id for id and label for label', () => {
  expect(WORKFLOW_OPTIONS.map((o) => o.id)).toEqual(
    WORKFLOW_KINDS.map((k) => k.id),
  );
  for (const kind of WORKFLOW_KINDS) {
    expect(WORKFLOW_OPTIONS.find((o) => o.id === kind.id)?.label).toBe(
      kind.label,
    );
  }
});

it('WORKFLOW_OPTIONS is a fresh array, so a consumer cannot mutate the source', () => {
  // The picker hands this straight to the form kernel; a shared reference would
  // let one screen's sort reorder another consumer's list.
  expect(WORKFLOW_OPTIONS).not.toBe(WORKFLOW_KINDS);
  expect(WORKFLOW_OPTIONS[0]).not.toBe(WORKFLOW_KINDS[0]);
});
