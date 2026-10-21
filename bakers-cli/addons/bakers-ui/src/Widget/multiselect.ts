// The `multiselect` widget: a label row and a checkbox per option, with the
// within-field cursor drawn only while the field is active.
//
// It draws its OWN bag failure (`ownsError`). That is not a preference: an empty
// checkbox list and a failed read look identical, so a bag that could not be
// loaded must say so exactly where the list would otherwise be — presenting a
// 404 as "there is nothing to choose" is the defect BB-257 AC-4 removes.

import { BODY_INDENT, note } from './chrome.js';
import type { FieldWidget } from './types.js';

const multiselectWidget: FieldWidget = {
  ownsError: true,
  inlineValue: false,
  render(ctx) {
    const rows = [`${ctx.field.label}:`];
    const list = ctx.list() ?? [];
    if (ctx.error !== undefined) {
      rows.push(...note(ctx.error, BODY_INDENT, ctx.width));
      // A failed roster can still hold prefilled selections the toggle keys
      // act on and Save writes; they stay visible so none changes unseen.
      if (list.length === 0) return rows;
    } else if (list.length === 0) {
      // The honest empty case: the query SUCCEEDED and there is nothing to
      // offer. `trusted` is false when a form-level failure means no read
      // succeeded at all, and then the popup knows nothing about this bag and
      // must claim nothing.
      if (ctx.trusted) rows.push(`${BODY_INDENT}(none available)`);
      return rows;
    }
    const chosen = ctx.chosen();
    list.forEach((option, i) => {
      const cursor = ctx.active && ctx.cursor === i ? '›' : ' ';
      const box = chosen.has(option.id) ? '[x]' : '[ ]';
      rows.push(`   ${cursor}${box} ${option.label}`);
    });
    return rows;
  },
};

export default multiselectWidget;
