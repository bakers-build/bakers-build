// The `action` widget: a button row. It holds no value and reads no bag — the
// reducer treats `submit`/`cancel` as the caller's business — so all it renders
// is its own label between the brackets that say it is pressable.

import type { FieldWidget } from './types.js';

const actionWidget: FieldWidget = {
  ownsError: false,
  inlineValue: false,
  render: (ctx) => [`[ ${ctx.field.label} ]`],
};

export default actionWidget;
