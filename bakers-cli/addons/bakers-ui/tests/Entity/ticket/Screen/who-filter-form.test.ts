import { describe, expect, it, vi } from 'vitest';
import { WhoFilterScreen } from '../../../../src/Entity/ticket/Screen/who-filter-form.js';
import type { ScreenContext } from '../../../../src/Screen/screen.js';
import type { TuiOptions } from '../../../../src/types.js';
import { renderTree } from '../../../render-tree.js';
import { fakeClient } from '../../../test-support.js';

// BB-309 — the Who picker's key contract, driven exactly the way the sibling
// `parent-filter-form.test.ts` drives the parent picker (the file `who-filter-form.ts`
// says it mirrors).
//
// What is pinned here is the fact three documents now state: the two pickers are
// the same one-field autocomplete shape, but only the parent filter passes a
// `KeyContext` carrying its field count. `who-filter-form.ts:117` calls
// `keyToIntent(input, field)` with none, so `singleAutocomplete` is false
// (`Form/keys.ts:29-30`), `\t` and `\x1b[Z` yield field `move`s, and a form with
// one field has nowhere to move them. On the Who picker both keys do nothing.
//
// Passing the count here was considered and rejected: it would change behaviour on
// a screen outside BB-309's surface. The gap is documented and left to its own
// ticket — so it is asserted rather than assumed, in both directions: ←/→ DO walk
// the suggestions, which is what keeps the negative assertion from passing on a
// picker that simply renders nothing.

const PROJECT = { id: 'proj-1', name: 'bakers', slug: 'bakers' };
const USERS = 'user/user';

const user = (id: string, name: string, uid: number) => ({
  type: 'user--user',
  id,
  attributes: { name, display_name: name, drupal_internal__uid: uid },
});

const doc = {
  [USERS]: {
    data: [user('u1', 'cwiedemann', 3), user('u2', 'cwestphal', 4)],
  },
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

/** A debounce that fires synchronously — no test sleeps past a real timer. */
const immediate = (fn: () => void): (() => void) => {
  fn();
  return () => {};
};

function context(overrides: Partial<ScreenContext> = {}): ScreenContext {
  return {
    sessionGeneration: 1,
    requestDraw: vi.fn(),
    isActive: () => true,
    options: { debounce: immediate } as TuiOptions,
    ...overrides,
  };
}

/** Opened AND typed past the two-character gate — below it the picker is empty
 *  by design (BB-299 D6/AC-5), and an empty picker has no cursor to move. */
async function openWithSuggestions() {
  const client = fakeClient({ documents: doc });
  const back = vi.fn(() => true);
  const screen = new WhoFilterScreen();
  const ctx = context({
    services: { client } as ScreenContext['services'],
    project: PROJECT,
    back,
  });
  screen.enter(ctx);
  await tick();
  for (const char of 'cw') screen.handleInput(char, ctx);
  await tick();
  return { client, back, screen, ctx };
}

// BB-340 — the picker hands over a TREE, so its text is read back out of the
// nodes rather than off a `lines` surface it no longer has.
const frameOf = (screen: WhoFilterScreen, ctx: ScreenContext): string =>
  renderTree(screen.present(ctx).body).join('\n');

describe('WhoFilterScreen — Tab/Shift+Tab (BB-309)', () => {
  it('←/→ DO walk the suggestions — the cursor is observable here', async () => {
    const { screen, ctx } = await openWithSuggestions();
    expect(frameOf(screen, ctx)).toContain('›cwiedemann');
    screen.handleInput('right', ctx);
    const frame = frameOf(screen, ctx);
    expect(frame).toContain('›cwestphal');
    expect(frame).not.toContain('›cwiedemann');
    screen.handleInput('left', ctx);
    expect(frameOf(screen, ctx)).toContain('›cwiedemann');
  });

  it('Tab and Shift+Tab do NOT move the suggestion cursor — they are field moves', async () => {
    const { screen, ctx } = await openWithSuggestions();
    expect(frameOf(screen, ctx)).toContain('›cwiedemann');
    screen.handleInput('tab', ctx);
    // Still on the first suggestion: the intent was `move`, and the form's one
    // field clamps it away.
    expect(frameOf(screen, ctx)).toContain('›cwiedemann');
    expect(frameOf(screen, ctx)).not.toContain('›cwestphal');
    screen.handleInput('shift+tab', ctx);
    expect(frameOf(screen, ctx)).toContain('›cwiedemann');
    expect(frameOf(screen, ctx)).not.toContain('›cwestphal');
  });

  it('neither key types into the query or commits a pick', async () => {
    const { back, client, screen, ctx } = await openWithSuggestions();
    const before = client.requests.length;
    screen.handleInput('tab', ctx);
    screen.handleInput('shift+tab', ctx);
    await tick();
    // A field move is not an `insert`, so no re-query is issued…
    expect(client.requests).toHaveLength(before);
    // …and no result leaves the picker: only Enter and Esc back out.
    expect(back).not.toHaveBeenCalled();
  });
});
