/**
 * @file
 * The flow-chart behaviour: "new" and "done" per section, the area between
 * them filled by which one is larger.
 *
 * Built exactly like stat-comparison.src.js — a Drupal behaviour guarded by
 * once, colours read from the token custom properties (no colour literals), a
 * MutationObserver re-reading them when the mode changes, and a detach
 * on `unload` that releases chart and observer. See that file for the why.
 *
 * Chart.js's own legend and tooltip stay off: the legend is markup, and the
 * tooltip is the markup element the component renders inside the host, so the
 * same values reach a keyboard and a screen reader (through the live region)
 * as reach the mouse. Every word comes from the markup; this file holds none.
 */
import {
  CategoryScale,
  Chart,
  Filler,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
} from 'chart.js';

Chart.register(CategoryScale, LinearScale, LineController, LineElement, PointElement, Filler);

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
 * Reads every colour and font the canvas paints with.
 *
 * @param {Element} host
 *   The chart host element.
 *
 * @return {object}
 *   The resolved palette.
 */
function palette(host) {
  return {
    new: token(host, 'color-chart-flow-new'),
    done: token(host, 'color-chart-flow-done'),
    grows: token(host, 'color-chart-flow-grows'),
    shrinks: token(host, 'color-chart-flow-shrinks'),
    surface: token(host, 'color-surface'),
    band: token(host, 'color-surface-3'),
    grid: token(host, 'color-border'),
    text: token(host, 'color-text-light'),
    family: getComputedStyle(host).fontFamily,
    medium: token(host, 'font-weight-medium'),
  };
}

/**
 * Builds the per-dataset colour properties for one series.
 *
 * @param {object} model
 *   The `chart` prop.
 * @param {object} colours
 *   The resolved palette.
 * @param {string} key
 *   `new` or `done`.
 *
 * @return {object}
 *   Chart.js dataset colour properties.
 */
function seriesColours(model, colours, key) {
  // Running and cut sections are hollow: a surface fill inside a series ring.
  const hollow = model.sections.map((section) => section.running || section.cut);
  return {
    borderColor: colours[key],
    backgroundColor: colours[key],
    pointBackgroundColor: hollow.map((h) => (h ? colours.surface : colours[key])),
    pointBorderColor: hollow.map((h) => (h ? colours[key] : colours.surface)),
    pointHoverBackgroundColor: hollow.map((h) => (h ? colours.surface : colours[key])),
    pointHoverBorderColor: hollow.map((h) => (h ? colours[key] : colours.surface)),
  };
}

/**
 * Builds the scale options.
 *
 * @param {Element} host
 *   The chart host element.
 * @param {object} model
 *   The `chart` prop.
 * @param {object} colours
 *   The resolved palette.
 *
 * @return {object}
 *   Chart.js scales.
 */
function scales(host, model, colours) {
  const font = { family: colours.family, size: 12 };
  return {
    x: {
      // A single section sits in the middle rather than on the left edge.
      offset: model.sections.length === 1,
      grid: { display: false },
      border: { display: false },
      ticks: {
        color: colours.text,
        font,
        maxRotation: 0,
        autoSkip: true,
        // The running section's label gets a second line.
        callback(value, index) {
          const section = model.sections[index];
          return section && section.running ? [section.label, host.dataset.labelRunning] : section ? section.label : '';
        },
      },
    },
    y: {
      beginAtZero: true,
      grid: { color: colours.grid, lineWidth: 1 },
      border: { display: false },
      ticks: { color: colours.text, font, maxTicksLimit: 5 },
    },
  };
}

Drupal.behaviors.bakersFlowChart = {
  // Every live chart, keyed by the host that owns it; detach disposes of these.
  live: new Map(),

  attach(context) {
    once('bakers-flow-chart', '[data-flow-chart]', context).forEach((host) => {
      const canvas = host.querySelector('canvas');
      if (!canvas) {
        return;
      }
      let model;
      try {
        model = JSON.parse(host.dataset.flowChart);
      } catch {
        return;
      }
      if (!Array.isArray(model.sections) || !model.sections.length) {
        return;
      }
      const tooltip = host.querySelector('[data-flow-chart-tooltip]');
      const live = host.querySelector('[data-flow-chart-live]');
      const state = { active: null, colours: palette(host) };

      // Paints the hovered or focused section's column behind the lines.
      const band = {
        id: 'flowChartBand',
        // Before the grid and the fill, so the column sits behind everything.
        beforeDraw(chart) {
          if (state.active === null) {
            return;
          }
          const { ctx, chartArea } = chart;
          const x = chart.scales.x.getPixelForValue(state.active);
          const count = model.sections.length;
          const width = count > 1 ? chartArea.width / (count - 1) : chartArea.width;
          ctx.save();
          ctx.beginPath();
          ctx.rect(chartArea.left, chartArea.top, chartArea.width, chartArea.height);
          ctx.clip();
          ctx.globalAlpha = 0.55;
          ctx.fillStyle = state.colours.band;
          ctx.fillRect(x - width / 2, chartArea.top, width, chartArea.height);
          ctx.restore();
        },
      };

      // Names each line at its last point, in the series colour.
      const endLabels = {
        id: 'flowChartEndLabels',
        afterDatasetsDraw(chart) {
          const { ctx } = chart;
          const last = model.sections.length - 1;
          const points = [0, 1].map((index) => chart.getDatasetMeta(index).data[last]);
          if (!points[0] || !points[1]) {
            return;
          }
          // The higher line's label sits above its point, the other one below,
          // so the two never overlap where the lines end close together.
          const newOnTop = points[0].y <= points[1].y;
          ctx.save();
          ctx.font = `${state.colours.medium} 12px ${state.colours.family}`;
          ctx.textAlign = 'left';
          [
            [points[0], host.dataset.labelNew, state.colours.new, newOnTop],
            [points[1], host.dataset.labelDone, state.colours.done, !newOnTop],
          ].forEach(([point, text, colour, above]) => {
            ctx.fillStyle = colour;
            ctx.textBaseline = above ? 'bottom' : 'top';
            ctx.fillText(text, point.x + 8, point.y + (above ? 2 : -2));
          });
          ctx.restore();
        },
      };

      const dataset = (key, extra) => ({
        label: host.dataset[key === 'new' ? 'labelNew' : 'labelDone'],
        data: model.sections.map((section) => section[key]),
        borderWidth: 2,
        borderCapStyle: 'round',
        borderJoinStyle: 'round',
        tension: 0,
        pointRadius: 3.5,
        pointHoverRadius: 3.5,
        pointBorderWidth: 2,
        pointHoverBorderWidth: 2,
        // The interval that ends in the running section is not final yet.
        segment: {
          borderDash: (ctx) => (model.sections[ctx.p1DataIndex].running ? [1.5, 3.5] : undefined),
        },
        ...seriesColours(model, state.colours, key),
        ...extra,
      });

      const chart = new Chart(canvas, {
        type: 'line',
        data: {
          labels: model.sections.map((section) => section.label),
          datasets: [
            // Chart.js splits the fill at every crossing: above = new over done.
            dataset('new', { fill: { target: 1, above: state.colours.grows, below: state.colours.shrinks } }),
            dataset('done', { fill: false }),
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          layout: { padding: { right: 40, top: 8 } },
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: false },
            // stat-comparison registers the Tooltip plugin on the shared Chart.
            tooltip: { enabled: false },
            // Fill under both lines; per dataset it would cover half of "done".
            filler: { drawTime: 'beforeDatasetsDraw' },
          },
          scales: scales(host, model, state.colours),
          onHover(event, elements) {
            // Leaving the canvas clears the hover, but not a keyboard focus.
            if (elements.length) {
              show(elements[0].index);
            } else if (document.activeElement !== canvas) {
              show(null);
            }
          },
        },
        plugins: [band, endLabels],
      });

      /**
       * Makes one section active (or none) and mirrors it into the tooltip.
       *
       * @param {number|null} index
       *   The section index, or null to hide.
       * @param {boolean} redraw
       *   Whether the chart has to be redrawn (keyboard), as a hover redraws itself.
       */
      function show(index, redraw = false) {
        if (index === state.active) {
          return;
        }
        state.active = index;
        if (redraw) {
          chart.setActiveElements(index === null ? [] : [0, 1].map((datasetIndex) => ({ datasetIndex, index })));
          chart.update('none');
        }
        if (!tooltip) {
          return;
        }
        if (index === null) {
          tooltip.hidden = true;
          if (live) {
            live.textContent = '';
          }
          return;
        }
        const section = model.sections[index];
        const title = section.label + (section.running ? host.dataset.runningSuffix : '');
        tooltip.querySelector('[data-flow-chart-title]').textContent = title;
        tooltip.querySelector('[data-flow-chart-value="new"]').textContent = section.new;
        tooltip.querySelector('[data-flow-chart-value="done"]').textContent = section.done;
        const openRow = tooltip.querySelector('[data-flow-chart-open-row]');
        const openLabel = tooltip.querySelector('[data-flow-chart-open-label]');
        openRow.hidden = section.open === null || section.open === undefined;
        openLabel.dataset.label ??= openLabel.textContent;
        openLabel.textContent = section.running && model.open_at ? host.dataset.openRunningLabel : openLabel.dataset.label;
        tooltip.querySelector('[data-flow-chart-value="open"]').textContent = openRow.hidden ? '' : section.open;
        tooltip.hidden = false;

        // Beside the column, flipped to its left when it would leave the host.
        const x = chart.scales.x.getPixelForValue(index);
        const gap = 12;
        const left = x + gap + tooltip.offsetWidth > host.clientWidth ? x - gap - tooltip.offsetWidth : x + gap;
        tooltip.style.transform = `translate(${Math.max(0, left)}px, ${chart.chartArea.top}px)`;

        if (live) {
          const rows = [...tooltip.querySelectorAll('dl > div')]
            .filter((row) => !row.hidden)
            .map((row) => `${row.querySelector('dt').textContent} ${row.querySelector('dd').textContent}`);
          live.textContent = `${title}: ${rows.join(', ')}`;
        }
      }

      canvas.addEventListener('keydown', (event) => {
        const last = model.sections.length - 1;
        const moves = {
          ArrowRight: () => (state.active === null ? 0 : Math.min(last, state.active + 1)),
          ArrowLeft: () => (state.active === null ? last : Math.max(0, state.active - 1)),
          Home: () => 0,
          End: () => last,
          Escape: () => null,
        };
        if (!(event.key in moves)) {
          return;
        }
        event.preventDefault();
        show(moves[event.key](), true);
      });
      // Focus alone already shows a section: the latest, unless one is active.
      canvas.addEventListener('focus', () => show(state.active ?? model.sections.length - 1, true));
      canvas.addEventListener('blur', () => show(null, true));

      // The mode lives as an attribute on <html>; switching it
      // repaints the CSS but not a canvas, so the colours are re-read here.
      const observer = new MutationObserver(() => {
        state.colours = palette(host);
        chart.data.datasets.forEach((set, index) => {
          Object.assign(set, seriesColours(model, state.colours, index === 0 ? 'new' : 'done'));
        });
        chart.data.datasets[0].fill = { target: 1, above: state.colours.grows, below: state.colours.shrinks };
        chart.options.scales = scales(host, model, state.colours);
        chart.update('none');
      });
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-mode'],
      });
      this.live.set(host, { chart, observer });
    });
  },

  detach(context, settings, trigger) {
    // Only an unload actually removes the content.
    if (trigger !== 'unload') {
      return;
    }
    context.querySelectorAll('[data-flow-chart]').forEach((host) => {
      const entry = this.live.get(host);
      if (!entry) {
        return;
      }
      entry.observer.disconnect();
      entry.chart.destroy();
      this.live.delete(host);
      once.remove('bakers-flow-chart', host);
    });
  },
};
