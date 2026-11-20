/**
 * @file
 * Makes a wrapped-route dialog hull dismissible by Cancel, close control and Escape.
 *
 * Deviation from Drupal.behaviors: document-level delegation, because a
 * once() attachment raced the swapped close control. Initial focus is a
 * behavior: it must run when a dialog's markup arrives, not on a user event.
 */

((Drupal, once) => {
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
  // The control that opened each dialog, so an in-place close can return to it.
  const openers = new WeakMap();

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
      const opener = openers.get(dialog);
      if (opener?.isConnected) {
        opener.focus();
      }
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

  /**
   * Moves focus into an opened dialog's first field, never its close control.
   *
   * A picker's trigger counts as a field: a dialog of pickers alone has no
   * input to land on. A dialog without fields focuses its Cancel.
   */
  Drupal.behaviors.islandDialogFocus = {
    attach(context) {
      const selector = '[data-dialog][open], #drupal-off-canvas';
      // A swapped-in fragment can be the dialog itself, which a context query misses.
      const dialogs = [context, ...context.querySelectorAll(selector)].filter((el) => el.matches?.(selector));
      dialogs.forEach((dialog) => {
        // Focus is still on whatever opened it when the dialog arrives.
        const active = document.activeElement;
        if (!openers.has(dialog) && active && active !== document.body && !dialog.contains(active)) {
          openers.set(dialog, active);
        }
        // Rendered only: a closed picker's search field comes first but cannot take focus.
        const field = dialog.querySelector('[autofocus]')
          ?? [...dialog.querySelectorAll('input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled), [data-option-picker-trigger]')]
            .find((el) => el.checkVisibility())
          // A confirmation has no field: land on its safe choice, not behind it.
          ?? dialog.querySelector('[data-dialog-cancel]');
        // Keyed on the field: the off-canvas container outlives its content, a field does not.
        if (field && once('island-dialog-focus', field).length) {
          field.focus();
        }
      });
    },
  };
})(Drupal, once);
