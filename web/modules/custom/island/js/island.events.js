/**
 * @file
 * Re-renders the islands subscribed to an island event a response announced.
 *
 * A response names the event in HX-Trigger. Every island whose container
 * lists it in data-island-events (its placement's `events`) asks for itself
 * again: the boosted GET of the current page a navigation makes, which the
 * server answers with that island alone.
 */

((Drupal, once, htmx) => {
  const listening = new Set();

  const refresh = (name) => {
    document.querySelectorAll('[data-island-events]').forEach((island) => {
      if (island.dataset.islandEvents.split(' ').includes(name)) {
        htmx.ajax('GET', window.location.href, {
          target: island,
          swap: 'outerHTML',
          headers: { 'HX-Boosted': 'true' },
        });
      }
    });
  };

  Drupal.behaviors.islandEvents = {
    attach(context) {
      once('island-events', '[data-island-events]', context).forEach((island) => {
        island.dataset.islandEvents.split(' ').forEach((name) => {
          if (!listening.has(name)) {
            listening.add(name);
            document.addEventListener(name, () => refresh(name));
          }
        });
      });
    },
  };
})(Drupal, once, htmx);
