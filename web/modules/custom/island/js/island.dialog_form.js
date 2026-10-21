/**
 * @file
 * Refuses a swap that would empty a wrapped dialog instead of updating it.
 *
 * Deviation from Drupal.behaviors: a global htmx:beforeSwap listener, because
 * it must act before the swap.
 */

((htmx) => {
  /**
   * The `form#…` selection the requesting element declared, if any.
   *
   * @param {Element|undefined} elt
   *   The element that made the request.
   *
   * @return {string|null}
   *   The selector, or NULL when this guard does not apply.
   */
  function formSelection(elt) {
    if (!elt || typeof elt.getAttribute !== 'function') {
      return null;
    }
    const selector =
      elt.getAttribute('data-hx-select') || elt.getAttribute('hx-select');

    return selector && /^form#[\w-]+$/.test(selector) ? selector : null;
  }

  htmx.on('htmx:beforeSwap', (event) => {
    const detail = event.detail;
    if (!detail || detail.shouldSwap !== true || !detail.xhr) {
      return;
    }
    const { status } = detail.xhr;
    if (status < 200 || status > 299) {
      return;
    }
    // A successful event response deletes its own hull and holds no form.
    if (detail.xhr.getResponseHeader('HX-Reswap') === 'delete'
      && detail.xhr.getResponseHeader('HX-Retarget') === 'closest [data-dialog]') {
      return;
    }
    const selector = formSelection(detail.requestConfig && detail.requestConfig.elt);
    if (!selector) {
      return;
    }
    // Parsed so the lookup matches htmx's own querySelector.
    const answered = new DOMParser().parseFromString(
      detail.serverResponse || '',
      'text/html',
    );
    if (answered.querySelector(selector)) {
      return;
    }
    detail.shouldSwap = false;
    // responseURL: the followed redirect is the case this guards.
    const landing = detail.xhr.responseURL;
    if (landing) {
      window.location.assign(landing);
    }
  });
})(htmx);
