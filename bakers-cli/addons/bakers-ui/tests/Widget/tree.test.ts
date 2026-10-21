import { expect, it } from 'vitest';
import type { FieldDecl } from '../../src/Form/index.js';
import { renderDeclaredFieldsTree } from '../../src/Widget/index.js';
import { FieldTextarea } from '../../src/Widget/textarea.js';
import { idsOf, nodeById } from '../render-tree.js';

// BB-340 Task 9 Step 3 — the widget layer's surface: a VNode tree.
//
// It was the SECOND surface while four popups still composed a modal out of
// text; Step 5 deleted `renderDeclaredFields` with the last of them, and with it
// the equivalence case that held the two pictures together. That guard died with
// its subject rather than being weakened: what it asserted — that the tree draws
// the same thing the rows did — is now the only thing there is to assert, and
// every claim it made about a KIND is made against the tree in
// `tests/Widget/kinds.test.ts`.

const decl = (over: Partial<FieldDecl> & { id: string }): FieldDecl => ({
  label: over.id,
  kind: 'text',
  ...over,
});

const FIELDS = [
  decl({ id: 'title', label: 'Title', kind: 'text' }),
  decl({ id: 'owner', label: 'Owner', kind: 'select', from: 'people' }),
  decl({ id: 'go', label: 'Go', kind: 'action' }),
];

const OPTIONS = { people: [{ id: 'p1', label: 'ada' }] };

const state = (over: Record<string, unknown> = {}) => ({
  active: 0,
  cursor: 0,
  title: '',
  owner: 'p1',
  go: null,
  ...over,
});

it('ids are the FIELD`s own, never its position (D4/R4)', () => {
  const tree = renderDeclaredFieldsTree(
    FIELDS,
    state({ active: -1 }),
    OPTIONS,
    { width: 58 },
  );
  const ids = idsOf(tree);
  expect(ids).toContain('field-title');
  expect(ids).toContain('field-owner');
  expect(ids).toContain('field-go');
  // A reordered declaration must not patch one field's content onto another's
  // node, which is exactly what a positional key would do.
  expect(ids.some((id) => /^field-\d+$/.test(id))).toBe(false);
  // `mountTree`/`patchTree` throw on a repeat; catching it here is cheaper.
  expect(new Set(ids).size).toBe(ids.length);
});

it('an FOREGROUND_ACTIVE text field`s value block is a real widget, not composed rows', () => {
  // The point of the step: the insertion point stops being a coordinate into a
  // string surface and becomes a renderable that drives the terminal cursor
  // itself — which is what let `Kernel/caret-slot.ts` die in Step 5 (spec D3).
  const tree = renderDeclaredFieldsTree(
    FIELDS,
    state({ active: 0, cursor: 3, title: 'abcdef' }),
    OPTIONS,
    { width: 58 },
  );
  const input = nodeById(tree, 'field-title-input');
  expect(input).toBeDefined();
  expect(input?.type).toBe(FieldTextarea);
  const props = input?.props as { value?: string; caretOffset?: number };
  expect(props.value).toBe('abcdef');
  expect(props.caretOffset).toBe(3);
});

it('an FOREGROUND text field has no widget at all', () => {
  const tree = renderDeclaredFieldsTree(
    FIELDS,
    state({ active: -1, title: 'abcdef' }),
    OPTIONS,
    { width: 58 },
  );
  expect(nodeById(tree, 'field-title-input')).toBeUndefined();
});

it('the autocomplete`s query row is the same widget (BB-326 widget-fit F2)', () => {
  const fields = [
    decl({
      id: 'who',
      label: 'Who',
      kind: 'autocomplete',
      from: 'people',
      query: 'whoQuery',
    }),
  ];
  const tree = renderDeclaredFieldsTree(
    fields,
    { active: 0, cursor: 0, who: null, whoQuery: 'ad' },
    OPTIONS,
    { width: 58 },
  );
  const input = nodeById(tree, 'field-who-input');
  expect(input?.type).toBe(FieldTextarea);
});
