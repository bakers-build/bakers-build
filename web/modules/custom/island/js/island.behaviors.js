/**
 * @file
 * Re-attaches behaviours to out-of-band island fragments after a settle.
 *
 * Deviation from Drupal.behaviors: a global htmx listener, because it shims a
 * core defect that reads detail.elt late.
 */

(function (htmx) {
  /**
   * The elements settled by the response currently being processed.
   *
   * @type {Element[]}
   */
  let settled = [];

  /**
   * Processes the settled elements core's own bridge will not.
   */
  function flush() {
    const batch = settled;
    settled = [];
    // Core already processes the last one.
    batch.slice(0, -1).forEach((element) => {
      // A peer may have been removed by a later swap in the same response.
      if (!element.isConnected) {
        return;
      }
      htmx.trigger(element.parentElement || element, 'htmx:drupal:load');
    });
  }

  htmx.on('htmx:afterSettle', ({ detail }) => {
    // The settle loop is synchronous; the microtask drains the whole batch.
    if (settled.length === 0) {
      Promise.resolve().then(flush);
    }
    // Read now: deferring this read is the core defect.
    settled.push(detail.elt);
  });
})(htmx);
