/**
 * @file
 * Chip field: the Alpine component `chipField`.
 *
 * The control in the `field` slot is the form's value and the source of truth
 * on load (a refused submit re-renders it with what was chosen):
 * - free mode, a textarea: typed text becomes chips, one per line written
 *   back (e-mail addresses, marked when the browser rejects one);
 * - list mode, a multiple select: typing filters its options, and only a
 *   listed option becomes a chip; the chips write back its selection.
 * The `.src.js` suffix keeps SDC from attaching this ES module as a classic
 * library (see option_picker.src.js); it reaches the browser through
 * js/alpine.src.js.
 */

const SEPARATORS = /[\s,;]+/;
const COMMIT_KEYS = ['Enter', ',', ';', ' '];

/** The browser's own e-mail check, the one an `<input type="email">` uses. */
const probe = document.createElement('input');
probe.type = 'email';
export function isEmail(address) {
  probe.value = address;
  return probe.value !== '' && probe.checkValidity();
}

export function split(text) {
  return (text || '').split(SEPARATORS).filter(Boolean);
}

/** The options whose label contains the query, case-insensitively. */
export function matching(options, query) {
  const needle = query.trim().toLowerCase();
  return needle === '' ? [] : options.filter((option) => option.label.toLowerCase().includes(needle));
}

export default () => ({
  chips: [],
  placeholder: '',
  removeText: '',
  list: false,
  options: [],
  query: '',
  active: 0,

  init() {
    const field = this.$el.querySelector('select, textarea');
    this.field = field;
    this.list = field.tagName === 'SELECT';
    this.placeholder = field.getAttribute('placeholder') || this.$el.dataset.placeholder || '';
    this.removeText = this.$el.dataset.removeLabel;
    ['aria-invalid', 'aria-describedby'].forEach((name) => {
      if (field.hasAttribute(name)) {
        this.$refs.input.setAttribute(name, field.getAttribute(name));
      }
    });
    field.hidden = true;
    if (this.list) {
      this.options = [...field.options].map((option) => ({ value: option.value, label: option.label }));
      this.chips = [...field.selectedOptions].map((option) => ({ value: option.value, label: option.label, valid: true }));
      return;
    }
    this.add(field.value);
    // A submit straight from the input still sends what was typed last.
    field.form?.addEventListener('formdata', (event) => {
      this.commit();
      event.formData.set(field.name, field.value);
    });
  },

  /** List mode: the options matching the typed text, not chosen yet. */
  get matches() {
    const chosen = new Set(this.chips.map((chip) => chip.value));
    return matching(this.options.filter((option) => !chosen.has(option.value)), this.query);
  },

  get open() {
    return this.list && this.matches.length > 0;
  },

  optionId(index) {
    return `${this.field.id}-option-${index}`;
  },

  add(text) {
    const known = new Set(this.chips.map((chip) => chip.value));
    split(text).forEach((address) => {
      if (!known.has(address)) {
        known.add(address);
        this.chips.push({ value: address, label: address, valid: isEmail(address) });
      }
    });
    this.sync();
  },

  choose(option) {
    this.chips.push({ value: option.value, label: option.label, valid: true });
    this.$refs.input.value = '';
    this.query = '';
    this.active = 0;
    this.sync();
    this.$refs.input.focus();
  },

  commit() {
    const input = this.$refs.input;
    if (!this.list && input.value.trim() !== '') {
      this.add(input.value);
      input.value = '';
    }
  },

  remove(index) {
    this.chips.splice(index, 1);
    this.sync();
    this.$refs.input.focus();
  },

  removeLabel(chip) {
    return this.removeText.replace('@label', chip.label);
  },

  typed() {
    this.query = this.$refs.input.value;
    this.active = 0;
  },

  keydown(event) {
    const input = this.$refs.input;
    if (event.key === 'Backspace' && input.value === '' && this.chips.length) {
      event.preventDefault();
      this.chips.pop();
      this.sync();
    } else if (this.list) {
      this.listKey(event);
    } else if (COMMIT_KEYS.includes(event.key) && input.value.trim() !== '') {
      event.preventDefault();
      this.commit();
    }
  },

  listKey(event) {
    const count = this.matches.length;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (count) {
        this.active = (this.active + (event.key === 'ArrowDown' ? 1 : count - 1)) % count;
        document.getElementById(this.optionId(this.active))?.scrollIntoView({ block: 'nearest' });
      }
    } else if ((event.key === 'Enter' || event.key === 'Tab') && count) {
      event.preventDefault();
      this.choose(this.matches[this.active]);
    } else if (event.key === 'Enter' && this.query.trim() !== '') {
      // Unmatched text is never a chip, nor a submit.
      event.preventDefault();
    } else if (event.key === 'Escape' && count) {
      // Closes the list, not the dialog around it.
      event.preventDefault();
      event.stopPropagation();
      this.query = '';
      this.$refs.input.value = '';
    }
  },

  paste(event) {
    const text = event.clipboardData?.getData('text') || '';
    if (!this.list && split(text).length > 1) {
      event.preventDefault();
      this.add(`${this.$refs.input.value} ${text}`);
      this.$refs.input.value = '';
    }
  },

  sync() {
    if (this.list) {
      const chosen = new Set(this.chips.map((chip) => chip.value));
      [...this.field.options].forEach((option) => {
        option.selected = chosen.has(option.value);
      });
      return;
    }
    this.field.value = this.chips.map((chip) => chip.value).join('\n');
  },
});
