/**
 * @file
 * E-mail chips: the Alpine component `emailChips`.
 *
 * The textarea in the component is the form's value and the source of truth
 * on load (a refused submit re-renders it with what was typed); every change
 * to the chips writes it back as one address per line. The `.src.js` suffix
 * keeps SDC from attaching this ES module as a classic library (see
 * option_picker.src.js); it reaches the browser through js/alpine.src.js.
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

export default () => ({
  chips: [],
  placeholder: '',
  removeText: '',

  init() {
    const textarea = this.$el.querySelector('textarea');
    this.textarea = textarea;
    this.placeholder = textarea.getAttribute('placeholder') || '';
    this.removeText = this.$el.dataset.removeLabel;
    ['aria-invalid', 'aria-describedby'].forEach((name) => {
      if (textarea.hasAttribute(name)) {
        this.$refs.input.setAttribute(name, textarea.getAttribute(name));
      }
    });
    textarea.hidden = true;
    this.add(textarea.value);
    // A submit straight from the input still sends what was typed last.
    textarea.form?.addEventListener('formdata', (event) => {
      this.commit();
      event.formData.set(textarea.name, textarea.value);
    });
  },

  add(text) {
    const known = new Set(this.chips.map((chip) => chip.address));
    split(text).forEach((address) => {
      if (!known.has(address)) {
        known.add(address);
        this.chips.push({ address, valid: isEmail(address) });
      }
    });
    this.sync();
  },

  commit() {
    const input = this.$refs.input;
    if (input.value.trim() !== '') {
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
    return this.removeText.replace('@address', chip.address);
  },

  keydown(event) {
    const input = this.$refs.input;
    if (COMMIT_KEYS.includes(event.key) && input.value.trim() !== '') {
      event.preventDefault();
      this.commit();
    } else if (event.key === 'Backspace' && input.value === '' && this.chips.length) {
      event.preventDefault();
      this.chips.pop();
      this.sync();
    }
  },

  paste(event) {
    const text = event.clipboardData?.getData('text') || '';
    if (split(text).length > 1) {
      event.preventDefault();
      this.add(`${this.$refs.input.value} ${text}`);
      this.$refs.input.value = '';
    }
  },

  sync() {
    this.textarea.value = this.chips.map((chip) => chip.address).join('\n');
  },
});
