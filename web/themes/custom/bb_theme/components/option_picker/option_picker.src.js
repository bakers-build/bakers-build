/**
 * @file
 * Option picker disclosure, filter and PICK handler (BB-332, BB-420),
 * registered as an Alpine component rather than a Drupal behaviour.
 *
 * The logic below is MOVED, not rewritten. Every helper keeps its body and its
 * arguments; what changed is how the component is attached, where the open
 * state lives, and how a pick reaches the field's explanatory note.
 *
 * THE `.src.js` SUFFIX IS LOAD-BEARING, and it was measured rather than
 * chosen for tidiness. SDC auto-discovers a component's co-located
 * `<name>.js` and attaches it as that component's library, which Drupal then
 * serves as a CLASSIC script — and this file is an ES module. Named
 * `option_picker.js` it was concatenated verbatim into a classic aggregate,
 * where its `export default` is a syntax error that aborts the WHOLE
 * aggregate: the observable symptom was `Unexpected token 'export'` followed
 * by `Drupal is not defined`, with Underscore and every behaviour after it in
 * that file gone, and the picker looking merely "not wired". The suffix is
 * the theme's existing convention for a source file that reaches the browser
 * through the build, and it takes this file out of SDC's discovery: the
 * component ships no library of its own, and this module is bundled into
 * `dist/js/alpine.js` by the single entry point that imports it.
 *
 * THE OPEN STATE IS THE `open` PROPERTY. It used to be read back off the
 * trigger's `aria-expanded`, which made the DOM both the state and its own
 * rendering. The template still renders `aria-expanded` and the panel's
 * `hidden` from its `open` prop, so every state the acceptance criteria name
 * still holds with JavaScript disabled entirely; Alpine binds those exact two
 * attributes and nothing else.
 *
 * POSITIONING RUNS ON `$nextTick`, and that is load-bearing rather than
 * stylistic. `positionPanel` returns early while the panel is still `hidden`,
 * and Alpine flushes attribute bindings on its own scheduler — so positioning
 * in the same statement that sets `open` would measure a panel that is still
 * closed and silently skip the whole placement.
 *
 * It also FILTERS and RELABELS THE CREATE ROW. `searchable` used to be a pure
 * boundary — an input that filtered nothing — and half of it is now real: typing
 * narrows the option rows that are rendered, and retitles the create row to offer
 * the exact string that was typed. The other half is still a boundary, and the distinction is
 * the whole point. This filters what the server already sent; it does not FETCH
 * candidates, so the parent picker still offers only the rows its scene renders.
 * Sourcing real candidates belongs to the ticket that gives that field a query.
 *
 * Filtering hides a row with the `hidden` ATTRIBUTE, never a CSS class — the same
 * state vocabulary the panel itself uses, so a hidden row is hidden from assistive
 * technology too rather than merely painted away. It stays additive: with no
 * JavaScript every row renders, which is the full list.
 *
 * IT PICKS, AND WRITES (BB-420). A click on a `role="option"` row is the
 * write: it sets `aria-selected` from the row's real `<input>` when the row
 * is a control, and toggles the marker only on a presentational row, relabels the
 * trigger in the same sentence form the template derives its own text from,
 * and rewrites the picker's own hidden `<input>`s so the enclosing `<form>`
 * submits exactly what is now selected. THE HIDDEN INPUTS ARE THE CONTRACT —
 * one per selected value, and NONE AT ALL when nothing is set, which is how a
 * cleared field reaches the server as "unset" rather than as an empty
 * sentinel value (spec D5 of the ticket that gives these fields an
 * endpoint). The clear row is not a special case of that contract, it is the
 * whole point of it: picking it writes zero values.
 *
 * THE FIELD'S NOTE IS NOW AN EVENT, not a reach across the document. The old
 * `syncDependents()` queried `[data-option-picker-note="<name>"]` itself and
 * wrote into whatever it found, so the picker had to know about a widget it
 * does not own. A pick now dispatches `bakers-picker-picked` on the window with
 * the field name and the selected labels, and the note — rendered by
 * PickerWidget, which declares its own tiny Alpine scope — updates itself.
 * Sender and receiver, rather than one element writing into another.
 *
 * MULTIPLICITY IS READ OFF THE PANEL, not off a new attribute this file would
 * need the template to grow: `option_list.twig` already renders
 * `aria-multiselectable="true"` on its `role="listbox"` exactly when the
 * field is `multiple`, so that is the one existing hook this reads rather
 * than adding `data-option-picker-multiple` to `option_picker.twig`.
 *
 * THE INLINE VARIANT NEVER WRITES A HIDDEN INPUT (review finding, BB-420
 * Task 5 fix round 1). `option_picker.twig` states it in two places: the
 * inline variant's hidden inputs are gated `not is_inline and name`, because
 * "the pick is the write" and there is no `<form>` to submit them with — but
 * `table.twig`'s `kind == 'picker'` cell instantiates exactly that variant
 * WITH a `name` set, so `name` alone was never a safe signal for whether to
 * write. `data-option-picker-variant` is the data hook this reads instead —
 * unlike multiplicity, there was no existing attribute carrying it, so this
 * is the one place `option_picker.twig` needed to grow one.
 *
 * THE SELECTED MARKER IS A CLONED ICON, not a hand-built one. The checkmark
 * is `{{ include('bb_theme:icon', {name: 'check'}) }}` — an inline SVG
 * `<use>` against the sprite path baked in at render time — and duplicating
 * that path here would silently rot the day the sprite moves. Every panel
 * that can ever need a check already renders at least one, on the row that
 * currently reads as selected (a real option, or the clear row when nothing
 * else is), so a newly selected row clones THAT node instead of one this
 * file would have to construct from scratch.
 *
 * Alpine initialises any subtree inserted into the document by itself, without
 * waiting for an event, which is what makes this survive an htmx swap.
 *
 * Drupal owns required checks, submission availability and validation messages.
 */

// Keep the complete menu reachable even when its trigger is near an edge.
const positionPanel = (picker) => {
  const trigger = picker.querySelector('[data-option-picker-trigger]');
  const panel = picker.querySelector('[data-option-picker-panel]');
  if (!trigger || !panel || panel.hidden) return;
  const margin = 8;
  const gap = 6;
  const width = document.documentElement.clientWidth;
  const height = window.innerHeight;
  const dialog = picker.closest('dialog');
  const clip = dialog?.getBoundingClientRect();
  const leftEdge = Math.max(margin, clip ? clip.left + margin : margin);
  const rightEdge = Math.min(width - margin, clip ? clip.right - margin : width - margin);
  const topEdge = Math.max(margin, clip ? clip.top + margin : margin);
  const bottomEdge = Math.min(height - margin, clip ? clip.bottom - margin : height - margin);
  const availableWidth = Math.max(0, rightEdge - leftEdge);
  panel.style.marginTop = '0';
  const anchor = trigger.getBoundingClientRect();
  const origin = picker.getBoundingClientRect();
  panel.style.minWidth = Math.min(264, availableWidth) + 'px';
  panel.style.maxWidth = Math.min(360, availableWidth) + 'px';
  const below = Math.max(0, bottomEdge - anchor.bottom - gap);
  const above = Math.max(0, anchor.top - gap - topEdge);
  const upward = below < Math.min(280, panel.scrollHeight) && above > below;
  panel.style.maxHeight = Math.min(280, upward ? above : below) + 'px';
  const bounds = panel.getBoundingClientRect();
  const preferredLeft = picker.getAttribute('data-option-picker-variant') === 'inline'
    ? anchor.right - bounds.width : anchor.left;
  const left = Math.max(leftEdge, Math.min(preferredLeft, rightEdge - bounds.width));
  const top = upward ? anchor.top - gap - bounds.height : anchor.bottom + gap;
  panel.style.left = (left - origin.left) + 'px';
  panel.style.right = 'auto';
  panel.style.top = (Math.max(topEdge, top) - origin.top) + 'px';
};

/**
 * Relabel the create row so it names what would be created.
 *
 * With a query the row offers that exact string — `Create "foo"` — which is
 * what makes inline creation feel like a continuation of typing rather than a
 * separate act. With an empty box it falls back to the plain invitation the
 * template rendered, so the row never reads as an offer to create nothing.
 *
 * It relabels only. Creating the entity belongs to the ticket that gives these
 * pickers an endpoint; nothing here posts.
 *
 * @param {Element} picker
 *   The picker whose create row is being relabelled.
 * @param {string} query
 *   The raw query as typed.
 */
const relabelCreateRow = (picker, query) => {
  const row = picker.querySelector('[data-option-list-create]');
  if (!row) {
    return;
  }
  const label = row.querySelector('.option-list__create-label');
  if (!label) {
    return;
  }
  const needle = query.trim();
  const noun = row.getAttribute('data-create-noun') || 'item';
  label.textContent = needle === '' ? `+ New ${noun}` : `Create "${needle}"`;
};

/**
 * Narrow the rendered option rows to those matching the query.
 *
 * The row's own visible label is what is matched, not its whole text content:
 * a row may carry a secondary description ("P2 / Normal"), and matching that
 * too would make a query hit rows whose label does not contain it, which reads
 * as a bug. An empty query restores every row, so clearing the box is always
 * the way back to the full list.
 *
 * @param {Element} picker
 *   The picker whose panel is being filtered.
 * @param {string} query
 *   The raw query as typed.
 */
const filterRows = (picker, query) => {
  const needle = query.trim().toLowerCase();
  const panel = picker.querySelector('[data-option-picker-panel]');
  if (!panel) {
    return;
  }
  relabelCreateRow(picker, query);
  panel.querySelectorAll('[role="option"]').forEach((row) => {
    const label = row.querySelector('.option-list__label');
    const haystack = (label ? label.textContent : row.textContent) || '';
    const matches =
      needle === '' || haystack.toLowerCase().includes(needle);
    if (matches) {
      row.removeAttribute('hidden');
    } else {
      row.setAttribute('hidden', '');
    }
  });
};

/**
 * Whether the field holds several values at once.
 *
 * Read off `option_list.twig`'s own `aria-multiselectable`, the existing
 * hook a multi-select panel already carries — see the file docblock for why
 * this is not a new attribute on the picker itself.
 *
 * @param {Element} picker
 * @returns {boolean}
 */
const isMultiple = (picker) => {
  const listbox = picker.querySelector('[data-option-picker-panel] [role="listbox"]');
  return !!listbox && listbox.getAttribute('aria-multiselectable') === 'true';
};

/**
 * Whether this picker is the `inline` variant — the pick IS the write, so
 * it never gets a hidden input, however it happens to be named.
 *
 * @param {Element} picker
 * @returns {boolean}
 */
const isInline = (picker) => picker.getAttribute('data-option-picker-variant') === 'inline';

/**
 * Rewrites the trigger's visible value, `title` and accessible name.
 *
 * Mirrors exactly what `option_picker.twig` itself derives from
 * `value_labels` — first label plus a `+N` count (C18), the same `title`
 * sentence (C19) and the same state-carrying `aria-label` — so a pick reads
 * no differently from a value the server had rendered to begin with.
 *
 * THE UNSET FIELD VARIANT RENDERS NO VALUE SPAN AT ALL (an unset pill reads
 * the field name alone), so clearing removes the span rather than emptying
 * it, and the first pick on a never-set field creates one rather than
 * updating one that was not there.
 *
 * @param {Element} picker
 * @param {string[]} labels
 */
const relabelTrigger = (picker, labels) => {
  const trigger = picker.querySelector('[data-option-picker-trigger]');
  if (!trigger) {
    return;
  }
  const fieldName = picker.getAttribute('data-option-picker-label') || '';
  const hasValue = labels.length > 0;
  const allValues = labels.join(', ');
  if (picker.hasAttribute('data-option-picker-selected-chips')) {
    trigger.setAttribute(
      'title',
      hasValue ? (isInline(picker) || fieldName === '' ? allValues : `${fieldName}: ${allValues}`) : fieldName,
    );
    trigger.setAttribute(
      'aria-label',
      `Change ${fieldName || 'value'}. ${hasValue ? `Currently ${allValues}.` : 'Nothing is set.'}`,
    );
    return;
  }
  const fieldSpan = trigger.querySelector('[data-picker-part="field"]');
  const facet = picker.getAttribute('data-option-picker-variant') === 'facet';

  let separator = trigger.querySelector('[data-picker-part="separator"]');
  let valueSpan = trigger.querySelector('[data-picker-part="value"]');
  let moreSpan = trigger.querySelector('[data-picker-part="more"]');
  // Keep the value bound identical before and after a selection.
  const bound = isInline(picker) ? 'max-w-60' : 'max-w-40';

  if (hasValue) {
    if (fieldSpan && !separator) {
      separator = document.createElement('span');
      separator.setAttribute('data-picker-part', 'separator');
      separator.className = 'shrink-0 text-text-faint';
      separator.setAttribute('aria-hidden', 'true');
      separator.textContent = '·';
      fieldSpan.after(separator);
    }
    if (!valueSpan) {
      valueSpan = document.createElement('span');
      valueSpan.setAttribute('data-picker-part', 'value');
      const anchor = separator ?? fieldSpan ?? trigger.querySelector('[data-picker-part="icon"]');
      if (anchor) {
        anchor.after(valueSpan);
      } else {
        trigger.prepend(valueSpan);
      }
    }
    valueSpan.className = `min-w-0 truncate ${bound}`;
    valueSpan.textContent = labels[0];
    if (labels.length > 1) {
      if (!moreSpan) {
        moreSpan = document.createElement('span');
        moreSpan.setAttribute('data-picker-part', 'more');
        moreSpan.className = 'shrink-0 text-text-light';
        valueSpan.after(moreSpan);
      }
      moreSpan.textContent = `+${labels.length - 1}`;
    } else if (moreSpan) {
      moreSpan.remove();
    }
  } else {
    if (moreSpan) {
      moreSpan.remove();
    }
    if (fieldSpan) {
      // Field variant, unset: neither renders server-side, so JS removes
      // both to match the same state exactly.
      if (separator) {
        separator.remove();
      }
      if (valueSpan) {
        valueSpan.remove();
      }
    } else if (valueSpan) {
      // Inline (or nameless) variant: the value span always renders,
      // falling back to the field name or a dash rather than disappearing.
      valueSpan.className = `min-w-0 truncate text-text-light ${bound}`;
      valueSpan.textContent = facet ? 'Any' : (fieldName !== '' ? fieldName : '—');
    }
  }

  trigger.setAttribute(
    'title',
    hasValue ? (isInline(picker) || fieldName === '' ? allValues : `${fieldName}: ${allValues}`) : fieldName,
  );
  trigger.setAttribute(
    'aria-label',
    `Change ${fieldName || 'value'}. ${hasValue ? `Currently ${allValues}.` : 'Nothing is set.'}`,
  );
};

/**
 * Rewrites the picker's own hidden inputs to be exactly `values`.
 *
 * Every hidden input this file ever wrote (and every one the template
 * rendered, once `init()` has marked it — see below) carries
 * `data-option-picker-value`, so this can always find and clear the whole
 * set before writing the new one. An empty `values` therefore leaves NONE
 * behind — no sentinel, an absent key — which is the contract the form
 * this ticket gives these fields reads by.
 *
 * THE INLINE VARIANT NEVER GETS ONE, whatever `name` it carries — see the
 * file docblock. It still relabels: the pick is visible either way, it
 * simply is not what makes the request.
 *
 * @param {Element} picker
 * @param {string[]} values
 * @param {string[]} labels
 */
/**
 * Rebuilds removable selected chips from the currently selected option rows.
 *
 * Chip identity is the option `data-value`, never a label index, so two
 * accounts that share a display name can be removed independently.
 *
 * @param {Element} picker
 */
const renderChips = (picker) => {
  if (!picker.hasAttribute('data-option-picker-selected-chips')) {
    return;
  }
  const fieldName = picker.getAttribute('data-option-picker-label') || 'selection';
  const selected = Array.from(
    picker.querySelectorAll('[data-option-picker-panel] [role="option"][aria-selected="true"]'),
  ).filter((row) => !row.hasAttribute('data-option-list-clear'));
  let wrap = picker.querySelector('[data-option-picker-chips]');
  if (!wrap) {
    wrap = document.createElement('span');
    wrap.setAttribute('data-option-picker-chips', '');
    wrap.className = 'inline-flex flex-wrap items-center gap-inline-xs';
    picker.querySelector('[data-option-picker-trigger]')?.after(wrap);
  }
  const iconSource = wrap.querySelector('[data-option-picker-chip-remove] svg');
  wrap.replaceChildren();
  selected.forEach((row) => {
    const value = row.getAttribute('data-value') ?? '';
    const labelNode = row.querySelector('.option-list__label');
    const label = (labelNode ? labelNode.textContent : '').trim();
    const chip = document.createElement('span');
    chip.setAttribute('data-option-picker-chip', '');
    chip.setAttribute('data-value', value);
    chip.className = 'inline-flex items-center gap-inline-xs h-6 max-w-40 px-1.5 rounded-full border border-control-border bg-app text-meta';
    const text = document.createElement('span');
    text.className = 'min-w-0 truncate';
    text.title = label;
    text.textContent = label;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.setAttribute('data-option-picker-chip-remove', '');
    remove.className = 'shrink-0 text-text-faint hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring';
    remove.setAttribute('aria-label', `Remove ${label} from ${fieldName}`);
    if (iconSource) {
      remove.appendChild(iconSource.cloneNode(true));
    }
    else {
      remove.textContent = '×';
    }
    chip.append(text, remove);
    wrap.append(chip);
  });
  wrap.hidden = selected.length === 0;
};

const writeValues = (picker, values, labels) => {
  const name = picker.getAttribute('data-option-picker-name');
  const multiple = isMultiple(picker);
  picker
    .querySelectorAll(':scope > input[type="hidden"][data-option-picker-value]')
    .forEach((input) => input.remove());
  if (name && !isInline(picker)) {
    values.forEach((value) => {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = multiple ? `${name}[]` : name;
      input.value = value;
      input.setAttribute('data-option-picker-value', '');
      picker.appendChild(input);
    });
  }
  relabelTrigger(picker, labels);
  renderChips(picker);
};

/**
 * A row's real `<input>`, when `option_list.twig` rendered one (control
 * mode). That input is the single writer of the checked state (BB-564);
 * its presence is what tells the caller whether to read from it or to keep
 * writing the marker itself.
 *
 * @param {Element} row
 * @returns {?HTMLInputElement}
 */
const controlInput = (row) => row.querySelector('input[type="checkbox"], input[type="radio"]');

/**
 * Marks `row` selected or not.
 *
 * A control row (a real `<input>`) renders its checkmark from CSS
 * (`peer-checked:`, see `option_list.twig`) — this only keeps `aria-selected`
 * in step and never touches the marker, so there is exactly one writer of
 * the glyph. A presentational row has no input of its own; there the
 * checkmark is cloned from whichever marker in this panel already carries
 * one (see the file docblock) rather than built from scratch, and removed
 * outright when the row is deselected.
 *
 * @param {Element} panel
 * @param {Element} row
 * @param {boolean} selected
 */
const setRowSelected = (panel, row, selected) => {
  row.setAttribute('aria-selected', selected ? 'true' : 'false');
  if (controlInput(row)) {
    return;
  }
  const marker = row.querySelector('.option-list__marker');
  if (!marker) {
    return;
  }
  const icon = marker.querySelector('svg');
  if (selected && !icon) {
    const source = panel.querySelector('.option-list__marker svg');
    if (source) {
      marker.appendChild(source.cloneNode(true));
    }
  } else if (!selected && icon) {
    icon.remove();
  }
};

/**
 * Handles a click on one `role="option"` row of an open picker panel.
 *
 * Single-choice picks exclusively and asks to close, the same way a native
 * `<select>` would. Multi-choice toggles the row alone and leaves the panel
 * open, so several picks in a row are possible; when that leaves nothing
 * selected, the clear row reads as chosen again — the same DERIVED fact
 * `option_list.twig` states server-side (`clear_selected`).
 *
 * Closing is REPORTED rather than performed: the open state is the Alpine
 * component's property now, so this returns what it decided and the caller
 * applies it.
 *
 * @param {Element} picker
 * @param {Element} panel
 * @param {Element} row
 * @returns {{close: boolean, name: string, labels: string[]}}
 *   Whether the panel should close, and the field name and selected labels
 *   the caller announces to this field's note.
 */
const pickRow = (picker, panel, row) => {
  const multiple = isMultiple(picker);
  const isClear = row.hasAttribute('data-option-list-clear');
  const rows = Array.from(panel.querySelectorAll('[role="option"]'));
  const previousValues = rows
    .filter((candidate) => !candidate.hasAttribute('data-option-list-clear')
      && candidate.getAttribute('aria-selected') === 'true')
    .map((candidate) => candidate.getAttribute('data-value') ?? '');

  if (!multiple || isClear) {
    rows.forEach((candidate) => {
      const isRow = candidate === row;
      const input = controlInput(candidate);
      // A presentational exclusive pick still WRITES the choice. A control
      // radio is written here too, because this handler runs on the label
      // click BEFORE the browser's default action; assigning `checked` then
      // makes the native activation a no-op. The `change` BEF needs is
      // synthesised once below, only when the selection actually changed.
      if (input) {
        input.checked = isRow;
      }
      setRowSelected(panel, candidate, isRow);
    });
  } else {
    // A checkbox row's real `<input>` already toggled natively (once) by the
    // time the SECOND, label-forwarded click reaches here; reading it rather
    // than toggling again is what stops the double `pick()` call from
    // cancelling itself out. A presentational row keeps the old toggle,
    // since it has no input to read.
    const input = controlInput(row);
    setRowSelected(panel, row, input ? input.checked : row.getAttribute('aria-selected') !== 'true');
  }

  const selected = rows.filter(
    (candidate) => !candidate.hasAttribute('data-option-list-clear')
      && candidate.getAttribute('aria-selected') === 'true',
  );
  // Nothing selected reads as the clear row being chosen, exactly like the
  // template's own `clear_selected` derivation. The clear row owns no input,
  // so this still uses the clone/remove path; no marker carries an empty-box
  // border (see option_list.twig), so the cloned glyph is
  // the only mark.
  const clearRow = rows.find((candidate) => candidate.hasAttribute('data-option-list-clear'));
  if (clearRow) {
    setRowSelected(panel, clearRow, selected.length === 0);
  }

  const values = selected.map((candidate) => candidate.getAttribute('data-value') ?? '');
  const labels = selected.map((candidate) => {
    const label = candidate.querySelector('.option-list__label');
    return (label ? label.textContent : '').trim();
  });
  writeValues(picker, values, labels);

  // One click on a labelled control reaches pick() twice. Only the first
  // call changes the selection; the second must not emit another change.
  const selectionChanged = values.length !== previousValues.length
    || values.some((value, index) => value !== previousValues[index]);
  if (selectionChanged) {
    if (picker.hasAttribute('data-option-picker-name') && !isInline(picker)) {
      picker.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (!multiple) {
      // Facet radios are unnamed. Writing `checked` before the label's
      // default action swallows the native change BEF listens for, so
      // synthesise it once, on the first pick only.
      const chosen = controlInput(row);
      if (chosen) {
        chosen.dispatchEvent(new Event('change', { bubbles: true }));
      }
    } else if (isClear && isInline(picker)) {
      // Unchecking in script fires no native change; tell an autosaving form.
      picker.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  return {
    close: !multiple,
    name: picker.getAttribute('data-option-picker-name') || '',
    labels,
  };
};

/**
 * The picker's Alpine component.
 *
 * Registered once, in the theme's entry point and in the Storybook preview,
 * so a story exercises the same component the site runs.
 *
 * EVERY METHOD BELOW REACHES FOR `$root`, NEVER `$el`, and that is the one
 * rule that makes this component correct rather than a style preference.
 * Inside an Alpine expression `$el` is the element the EXPRESSION is bound
 * to, not the component's root: called from the panel's `@click` it is the
 * panel, called from the trigger's `@click` it is the button, called from the
 * search box's `@input` it is the input. Every helper in this file takes the
 * PICKER as its first argument, so `$el` silently hands each of them the
 * wrong node and each one then fails by finding nothing:
 * `writeValues(panel, …)` reads `data-option-picker-name` off the panel, gets
 * `null`, and writes no hidden input; `relabelTrigger(panel, …)` looks for a
 * trigger among the panel's descendants, finds none — the trigger is its
 * sibling — and returns; `positionPanel(trigger)` looks for the panel inside
 * the button and skips the whole placement. None of them throws, so a pick
 * looked exactly like "the handler never ran". `$root` is the component's own
 * root element whichever binding invoked the method, which is what every one
 * of these helpers was written to receive.
 *
 * @returns {object}
 *   The Alpine component definition.
 */
export default function optionPicker() {
  return {
    open: false,
    query: '',

    init() {
      // What the behaviour's `once` callback did on attach: mark the hidden
      // inputs the server already rendered, so the first pick replaces them
      // instead of adding to them.
      this.$root
        .querySelectorAll(':scope > input[type="hidden"]')
        .forEach((input) => input.setAttribute('data-option-picker-value', ''));

      // The readiness marker, and it is load-bearing rather than decoration.
      // A click that lands before this picker has been initialised does
      // nothing at all, and the run then fails several steps later on
      // `aria-expanded`, blaming the picker for what was a timing gap. The
      // `Drupal.behaviors` version gave the browser suite `once()`'s
      // `data-once` attribute to wait on; Alpine marks an initialised subtree
      // only on the element object, with nothing a selector can see, so the
      // component has to state its own readiness. The gap is real even though
      // Alpine needs no `attachBehaviors`: a dialog arriving through an htmx
      // swap is initialised by Alpine's MutationObserver callback, which is a
      // task later than the insertion an interaction can already race.
      this.$root.setAttribute('data-option-picker-ready', '');
      this.$root.addEventListener('click', (event) => {
        const button = event.target.closest('[data-option-picker-chip-remove]');
        if (!button || !this.$root.contains(button)) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        this.removeChip(button);
      });
    },

    toggle() {
      this.open = !this.open;
      this.reposition();
      // A keyboard user lands in the panel: on its search, else its first row.
      if (this.open) {
        this.$nextTick(() => {
          const search = this.$refs.panel.querySelector('[data-option-picker-search]');
          search ? search.focus() : this.focusRow(this.rows()[0]);
        });
      }
    },

    /** Focuses a row, which is only focusable once it has a tabindex. */
    focusRow(row) {
      if (row) {
        row.tabIndex = -1;
        row.focus();
      }
    },

    /** The panel's visible option rows, in order. */
    rows() {
      return [...this.$refs.panel.querySelectorAll('[role="option"]')].filter((row) => !row.hidden);
    },

    /**
     * Arrows move between rows; Enter or Space picks the focused row the way
     * a click on it does, and Enter in the search picks its first match.
     */
    keydown(event) {
      const rows = this.rows();
      const current = event.target.closest('[role="option"]');
      const index = rows.indexOf(current);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        this.focusRow(rows[event.key === 'ArrowDown' ? Math.min(index + 1, rows.length - 1) : Math.max(index - 1, 0)]);
        return;
      }
      const fromSearch = event.key === 'Enter' && event.target.matches('[data-option-picker-search]');
      const row = index >= 0 && (event.key === 'Enter' || event.key === ' ')
        ? current
        : (fromSearch ? rows.find((candidate) => !candidate.hasAttribute('data-option-list-clear')) : null);
      if (!row) {
        return;
      }
      event.preventDefault();
      // The row's own control keeps each row kind's pick semantics.
      (row.querySelector('label, a') ?? row).click();
      if (!this.open) {
        this.$refs.trigger?.focus();
      }
    },

    close() {
      this.open = false;
      this.query = '';
      filterRows(this.$root, '');
    },

    /** Escape closes and returns focus, so a keyboard user is never trapped. */
    dismiss() {
      if (!this.open) {
        return;
      }
      this.close();
      this.$refs.trigger?.focus();
    },

    filter() {
      // A remote picker's rows come from the server for the typed text.
      if (this.$root.hasAttribute('data-option-picker-remote')) {
        relabelCreateRow(this.$root, this.query);
        return;
      }
      filterRows(this.$root, this.query);
      this.reposition();
    },

    pick(row) {
      const picked = pickRow(this.$root, this.$refs.panel, row);
      this.$dispatch('bakers-picker-picked', {
        name: picked.name,
        labels: picked.labels,
      });
      if (picked.close) {
        this.close();
      }
    },

    /**
     * Drops one selected identity through the same pick path as the panel.
     *
     * @param {Element} button
     *   The chip's type=button remove control.
     */
    removeChip(button) {
      const chip = button.closest('[data-option-picker-chip]');
      const value = chip?.getAttribute('data-value');
      if (value == null || value === '') {
        return;
      }
      const row = this.$refs.panel?.querySelector(
        `[role="option"][data-value="${CSS.escape(value)}"]`,
      );
      if (!row) {
        return;
      }
      // Chip clicks never toggle the option's checkbox; pickRow reads
      // `input.checked` for control rows, so uncheck first or the chip stays.
      const input = controlInput(row);
      if (input) {
        input.checked = false;
      }
      this.pick(row);
      const leftover = this.$root.querySelector('[data-option-picker-chip-remove]');
      (leftover || this.$refs.trigger)?.focus();
    },

    /**
     * Places the panel inside the viewport.
     *
     * Deferred to `$nextTick` because `positionPanel` bails out while the
     * panel is still `hidden`, and Alpine flushes that binding on its own
     * scheduler rather than in the statement that changed `open`.
     */
    reposition() {
      if (!this.open) {
        return;
      }
      this.$nextTick(() => positionPanel(this.$root));
    },
  };
}
