/**
 * @file
 * Makes a wrapped-route dialog hull dismissible by Cancel, close control and Escape.
 *
 * Deviation from Drupal.behaviors: document-level delegation, because a
 * once() attachment raced the swapped close control.
 */

(() => {
  /**
   * Closes a dialog towards its own close target, if it has one.
   *
   * A hull swapped over the screen it returns to is removed in place; the
   * screen is already there. Otherwise the dialog is its own page, and closing
   * it navigates to the target.
   *
   * @param {Element} dialog
   *   The hull element.
   */
  function closeDialog(dialog) {
    const cancel = dialog.querySelector('[data-dialog-cancel]');
    if (!cancel || !cancel.href) {
      return;
    }
    // Opt-in: a control that changed the screen's data (e.g. a create
    // result's Done) asks for a reload of the current screen instead of a
    // plain in-place close, without having to carry that in its target URL.
    if (cancel.hasAttribute('data-dialog-reload')) {
      dialog.remove();
      window.location.reload();
      return;
    }
    const target = new URL(cancel.href, window.location.href);
    const here = window.location;
    if (target.pathname === here.pathname && target.search === here.search) {
      dialog.remove();
      return;
    }
    window.location.assign(cancel.href);
  }

  // closest(): a click usually lands on the icon inside the control.
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const control = target?.closest('[data-dialog-close], [data-dialog-cancel]');
    const dialog = control?.closest('[data-dialog]');
    if (dialog) {
      event.preventDefault();
      closeDialog(dialog);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') {
      return;
    }
    // The last open hull is the one on top.
    const open = document.querySelectorAll('[data-dialog][open]');
    const dialog = open[open.length - 1];
    if (dialog) {
      event.preventDefault();
      closeDialog(dialog);
    }
  });
})();
