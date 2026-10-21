// BB-257 (re-entry) — the WIDGET layer: one renderer per field kind, one
// loading contract per field, and the single iteration both popups render
// through.
//
// Entity-agnostic by construction, and asserted so (`tests/boundary.test.ts`
// G6): it imports the form kernel, `lib/` and the shared types, and nothing
// else. That is why it sits beside `src/Component/` and `src/lib/` rather than
// inside `src/Form/` (whose purity guard forbids reaching `lib/` at all) or
// under `Entity/<slice>/` (which would give each popup its own copy of a kind).
export {
  BODY_INDENT,
  BODY_INDENT_COLUMNS,
  clip,
  findOption,
  MARK_WIDTH,
  note,
  padLabel,
} from './chrome.js';
export {
  createOptionLoader,
  type OptionLoader,
  type OptionLoaderDeps,
  type OptionOutcome,
  type OptionSource,
  type OptionSources,
  primeSources,
} from './option-source.js';
export {
  FIELDS_REGION,
  type FieldsChrome,
  renderDeclaredFieldsTree,
  renderWidget,
  WIDGETS,
  widgetFor,
} from './render.js';
export { FieldTextarea, type FieldTextareaOptions } from './textarea.js';
export type { FieldCaret, FieldWidget, WidgetContext } from './types.js';
