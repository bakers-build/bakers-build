/**
 * @file
 * The theme's Chart.js bundle: the stat-comparison chart behaviour.
 *
 * WHY A BEHAVIOUR AND NOT ALPINE. Chart.js owns a canvas imperatively and has to
 * be told when its container resizes or its colours change; Alpine's declarative
 * binding buys nothing for that, and a `<canvas>` has no markup to bind to. So
 * this is a plain Drupal behaviour, guarded by core/once, which core's htmx
 * bridge re-runs on swapped content.
 *
 * WHY IT ALSO IMPLEMENTS DETACH. A Chart instance and a document-level observer
 * outlive the element that owns them: htmx removes the host from the document,
 * but the observer on <html> keeps host, chart and canvas back-buffer reachable
 * for the document's lifetime. core's htmx bridge fires detach with the trigger
 * `unload` on the content it swaps away, so releasing both there is the missing
 * half of the same behaviour contract rather than a second mechanism.
 *
 * WHY NO COLOUR LITERALS. Every series colour is read at runtime from the
 * `--color-chart-series-*` custom property the token CSS sets. That is what makes
 * one chart follow both colour modes without a second palette here, and it is the
 * project's standing rule that a component styles through semantic tokens rather
 * than values copied out of them.
 */
import {
  CategoryScale,
  Chart,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from 'chart.js';

Chart.register(
  CategoryScale,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
);

/**
 * Reads one custom property off an element, resolved against the active theme.
 *
 * @param {Element} element
 *   The element to resolve against.
 * @param {string} name
 *   The custom property name, without the leading `--`.
 *
 * @return {string}
 *   The computed value, or an empty string when the property is unset.
 */
function token(element, name) {
  return getComputedStyle(element).getPropertyValue(`--${name}`).trim();
}

/**
 * Builds the Chart.js configuration for one prepared model.
 *
 * @param {Element} host
 *   The chart host element the colours are resolved against.
 * @param {object} model
 *   The `chart` prop as the component rendered it.
 *
 * @return {object}
 *   A Chart.js line-chart configuration.
 */
function configure(host, model) {
  const grid = token(host, 'color-border-2');
  const text = token(host, 'color-text-light');
  return {
    type: 'line',
    data: {
      labels: model.labels || [],
      datasets: (model.series || []).map((series) => ({
        label: series.label,
        // {x, y} points, where `y: null` is a gap — see the component's own
        // note on why a gap is not a null array element.
        data: series.values || [],
        parsing: { xAxisKey: 'x', yAxisKey: 'y' },
        borderColor: token(host, `color-chart-series-${series.style}`),
        backgroundColor: token(host, `color-chart-series-${series.style}`),
        borderWidth: 2,
        pointRadius: 3,
        pointHoverRadius: 5,
        tension: 0.25,
        // A missing observation is a gap in the data, not a zero, but the line
        // stays connected across it so a sparse series is still one line.
        spanGaps: true,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      // The legend is markup in the component; a canvas legend would duplicate
      // it and only the markup one is reachable without the canvas.
      plugins: { legend: { display: false } },
      scales: {
        x: {
          grid: { display: false },
          border: { color: text },
          ticks: { color: text, maxRotation: 0, autoSkip: true },
        },
        y: {
          beginAtZero: true,
          title: { display: Boolean(model.value_label), text: model.value_label, color: text },
          grid: { color: grid },
          border: { display: false },
          ticks: { color: text },
        },
      },
    },
  };
}

/**
 * Re-reads every colour off the host and pushes it into a live chart.
 *
 * @param {Element} host
 *   The chart host element.
 * @param {object} model
 *   The model the chart was built from.
 * @param {Chart} chart
 *   The live chart instance.
 */
function recolour(host, model, chart) {
  const next = configure(host, model);
  chart.data.datasets.forEach((dataset, index) => {
    dataset.borderColor = next.data.datasets[index].borderColor;
    dataset.backgroundColor = next.data.datasets[index].backgroundColor;
  });
  chart.options.scales = next.options.scales;
  chart.update('none');
}

Drupal.behaviors.bakersStatComparison = {
  // Every live chart, keyed by the host that owns it. This is what detach
  // disposes of, and it is also the only way a leaked instance stays countable
  // once its host has left the document.
  live: new Map(),

  attach(context) {
    once('bakers-stat-comparison', '[data-stat-comparison]', context).forEach((host) => {
      const canvas = host.querySelector('canvas');
      if (!canvas) {
        return;
      }
      let model;
      try {
        model = JSON.parse(host.dataset.statComparison);
      } catch {
        return;
      }
      const chart = new Chart(canvas, configure(host, model));
      // The mode lives as an attribute on <html>; switching it
      // repaints the CSS but not a canvas, so the colours are re-read here.
      const observer = new MutationObserver(() => recolour(host, model, chart));
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-mode'],
      });
      this.live.set(host, { chart, observer });
    });
  },

  detach(context, settings, trigger) {
    // Only an unload actually removes the content; a 'serialize' or 'move'
    // detach leaves the host in place and its chart has to keep running.
    if (trigger !== 'unload') {
      return;
    }
    context.querySelectorAll('[data-stat-comparison]').forEach((host) => {
      const entry = this.live.get(host);
      if (!entry) {
        return;
      }
      entry.observer.disconnect();
      entry.chart.destroy();
      this.live.delete(host);
      once.remove('bakers-stat-comparison', host);
    });
  },
};
