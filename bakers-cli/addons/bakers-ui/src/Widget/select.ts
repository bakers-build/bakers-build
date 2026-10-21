// The `select` widget: one row, `<label>: < value >`.
//
// `< … >` names the two keys that change it. The row is deliberately not
// wrapped or clipped: a ring's value is one option's label, the popup is as wide
// as the option lists were composed for, and a cursor over a value split across
// two rows would stop lining up with its field.

import { findOption, padLabel } from './chrome.js';
import type { FieldWidget } from './types.js';

/** Nothing is selected but the field CAN be empty (BB-233 AC-4's `clearable`). */
const NONE = '— none —';
/** An id with no matching option: legible, and not a claim that it is empty. */
const UNKNOWN = '—';

const selectWidget: FieldWidget = {
  ownsError: false,
  inlineValue: true,
  render(ctx) {
    const id = ctx.selected();
    const hit = findOption(ctx.list() ?? [], id);
    // Only a CLEARABLE select has a real "removed" state to name; in a ring that
    // cannot be emptied a null is merely an id we do not recognise. Collapsing
    // the two is what made the create and edit popups need two label lookups.
    const value =
      hit?.label ??
      (id === null && ctx.field.clearable === true ? NONE : UNKNOWN);
    return [`${padLabel(ctx.field.label, ctx.labelColumn)}< ${value} >`];
  },
};

export default selectWidget;
