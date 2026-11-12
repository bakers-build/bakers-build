/**
 * @file
 * Explicit Save for HTMX forms: one request at a time, failure reported.
 *
 * A successful save or a validation error comes back as the swapped form with
 * its own Drupal messages. Only a request that never completes needs this.
 */

((Drupal, once) => {
  Drupal.behaviors.formSave = {
    attach(context) {
      const selector = 'form[data-form-save]';
      const forms = Array.from(context.querySelectorAll(selector));
      if (context.matches?.(selector)) forms.unshift(context);
      once('form-save', forms).forEach((form) => {
        const report = (text) => {
          const alert = form.querySelector('[data-form-save-status]');
          if (alert) {
            alert.textContent = text;
            alert.hidden = !text;
          }
        };
        const own = (callback) => (event) => {
          if (event.detail?.elt === form) callback(event);
        };
        // An edit makes the previous outcome stale; nothing is written yet.
        // Cleared while typing, not only on `change`: that fires on the blur
        // of pressing Save, and the shrinking form would move Save away from
        // under the pointer before the click completes.
        const stale = () => {
          form.querySelectorAll('[data-drupal-messages]').forEach((message) => message.remove());
          report('');
        };
        // The card's own Refresh replaces its input: ask only when there is
        // unsent input to lose, measured against the values it opened with.
        // A card returned with errors holds refused input, also unsent.
        const values = () => JSON.stringify(Array.from(new FormData(form))
          .map(([name, value]) => [name, typeof value === 'string' ? value : value.name]));
        const opened = values();
        const refused = form.querySelector('[aria-invalid="true"]') !== null;
        form.addEventListener('htmx:confirm', (event) => {
          if (!event.detail.elt.matches?.('[data-form-refresh]') || (!refused && values() === opened)) {
            return;
          }
          event.preventDefault();
          // eslint-disable-next-line no-alert
          if (window.confirm(Drupal.t('Discard the unsaved changes in this card?'))) {
            event.detail.issueRequest(true);
          }
        });
        form.addEventListener('input', stale);
        form.addEventListener('change', stale);
        form.addEventListener('htmx:beforeRequest', own(() => {
          report('');
          // Keep the submitted controls as sent until the response replaces
          // them. Inert also covers composite widgets whose options are not
          // inputs.
          form.inert = true;
        }));
        form.addEventListener('htmx:afterRequest', own(() => {
          form.inert = false;
        }));
        // An autosaving picker that submitted says it at its own field.
        const fail = own(() => form.querySelector('[data-option-picker-submitted]') || report(Drupal.t('Not saved.')));
        ['htmx:responseError', 'htmx:sendError', 'htmx:timeout', 'htmx:sendAbort']
          .forEach((name) => form.addEventListener(name, fail));
      });
    },
  };
})(Drupal, once);
