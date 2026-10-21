/**
 * @file
 * The square crop dialog of an image upload, registered as an Alpine component.
 *
 * Geometry is `{x, y, size}` in the ORIGINAL image's pixels: the top-left
 * corner and edge of the square. The viewport only scales it for display, so
 * a preview's CSS size never leaks into what is saved. The preview sets
 * `image-orientation: none`, because the server crops raw pixels.
 *
 * Three states, never mixed: `staged` is what the parent form will submit
 * (the hidden `crop` input mirrors it), `draft` is the open dialog's
 * selection, and the saved crop is whatever the server rendered into
 * `data-crop`. Apply copies draft to staged; Cancel and Escape drop the draft.
 * A new file stages its centred square before the dialog opens, so Cancel
 * keeps that default. The file itself is uploaded by the parent form's Save.
 *
 * `.src.js` keeps SDC from serving this ES module as a classic script.
 */

const MAX_ZOOM = 4;
const KEY_STEP = 10;

const parse = (json) => {
  try {
    const crop = JSON.parse(json || 'null');
    return crop && Number.isFinite(crop.x) && Number.isFinite(crop.y) && Number.isFinite(crop.size) ? crop : null;
  } catch {
    return null;
  }
};

export default () => ({
  src: '',
  width: 0,
  height: 0,
  staged: null,
  draft: null,
  zoom: 1,
  maxZoom: MAX_ZOOM,
  drag: null,
  viewport: 0,
  objectUrl: null,

  init() {
    const data = this.$root.dataset;
    this.src = data.src || '';
    this.width = Number(data.width) || 0;
    this.height = Number(data.height) || 0;
    this.staged = parse(data.crop) || (this.width ? this.centred() : null);
    // The widget's presenter renders its file and crop inputs into this root.
    this.input = this.$root.querySelector('input[data-bakers-crop-value]');
    this.file = this.$root.querySelector('input[type="file"]');
    this.onFile = () => this.pick();
    this.file?.addEventListener('change', this.onFile);
    // core's file.js disables every managed-file input while a button outside
    // the widget submits, so only an Upload button uploads. Here the file rides
    // with the parent form's Save by design, so it is put back.
    this.onFormData = (event) => {
      if (this.file.disabled && this.file.files?.[0]) {
        event.formData.append(this.file.name, this.file.files[0]);
      }
    };
    this.file?.form?.addEventListener('formdata', this.onFormData);
    this.$root.dataset.imageCropReady = '';
  },

  destroy() {
    this.file?.removeEventListener('change', this.onFile);
    this.file?.form?.removeEventListener('formdata', this.onFormData);
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
    }
  },

  /** A newly chosen file: preview it locally, stage its centre, open. */
  pick() {
    const file = this.file.files?.[0];
    if (!file) {
      return;
    }
    const url = URL.createObjectURL(file);
    const probe = new Image();
    probe.style.imageOrientation = 'none';
    probe.onload = () => {
      if (this.objectUrl) {
        URL.revokeObjectURL(this.objectUrl);
      }
      this.objectUrl = url;
      this.src = url;
      this.width = probe.naturalWidth;
      this.height = probe.naturalHeight;
      this.staged = this.centred();
      this.write();
      this.open();
    };
    probe.onerror = () => URL.revokeObjectURL(url);
    probe.src = url;
  },

  centred() {
    const size = Math.min(this.width, this.height);
    return { x: (this.width - size) / 2, y: (this.height - size) / 2, size };
  },

  clamp(crop) {
    const side = Math.min(this.width, this.height);
    const size = Math.min(Math.max(crop.size, side / MAX_ZOOM), side);
    return {
      size,
      x: Math.min(Math.max(crop.x, 0), this.width - size),
      y: Math.min(Math.max(crop.y, 0), this.height - size),
    };
  },

  /** Integer pixels that still lie inside the image after rounding. */
  rounded(crop) {
    const size = Math.max(1, Math.round(crop.size));
    return {
      x: Math.min(Math.round(crop.x), this.width - size),
      y: Math.min(Math.round(crop.y), this.height - size),
      size,
    };
  },

  write() {
    if (this.input && this.staged) {
      this.input.value = JSON.stringify(this.rounded(this.staged));
    }
  },

  open() {
    this.draft = { ...this.staged };
    this.zoom = Math.min(this.width, this.height) / this.draft.size;
    this.$refs.dialog.showModal();
    this.$nextTick(() => {
      this.viewport = this.$refs.viewport.clientWidth;
    });
  },

  close() {
    this.drag = null;
    this.$refs.dialog.close();
    this.$refs.edit.focus();
  },

  apply() {
    this.staged = this.clamp(this.draft);
    this.write();
    this.close();
  },

  reset() {
    this.draft = this.centred();
    this.zoom = 1;
  },

  zoomTo() {
    const centreX = this.draft.x + this.draft.size / 2;
    const centreY = this.draft.y + this.draft.size / 2;
    const size = Math.min(this.width, this.height) / this.zoom;
    this.draft = this.clamp({ x: centreX - size / 2, y: centreY - size / 2, size });
  },

  startPan(event) {
    this.$refs.viewport.setPointerCapture(event.pointerId);
    this.drag = { x: event.clientX, y: event.clientY, from: { ...this.draft } };
  },

  pan(event) {
    if (!this.drag) {
      return;
    }
    const scale = this.viewport / this.drag.from.size;
    this.draft = this.clamp({
      ...this.drag.from,
      x: this.drag.from.x - (event.clientX - this.drag.x) / scale,
      y: this.drag.from.y - (event.clientY - this.drag.y) / scale,
    });
  },

  endPan() {
    this.drag = null;
  },

  /** Arrow keys move the image like a drag does. */
  nudge(event) {
    const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const move = moves[event.key];
    if (!move) {
      return;
    }
    event.preventDefault();
    const step = (KEY_STEP * this.draft.size) / (this.viewport || 1);
    this.draft = this.clamp({ ...this.draft, x: this.draft.x - move[0] * step, y: this.draft.y - move[1] * step });
  },

  /** Inline geometry of an image showing `crop` in a square of `box` px. */
  frame(crop, box) {
    if (!crop || !box) {
      return '';
    }
    const scale = box / crop.size;
    return `width:${this.width * scale}px;height:${this.height * scale}px;left:${-crop.x * scale}px;top:${-crop.y * scale}px`;
  },
});
