/**
 * @file
 * The theme's Chart.js bundle, and the entry point that ships the chart behaviour.
 *
 * The behaviour itself lives beside the component it belongs to
 * (components/stat-comparison/stat-comparison.src.js); this file exists only to
 * give Vite an entry point for it, exactly as alpine.src.js does for
 * option_picker. Storybook reaches the same source through its own
 * `components/**\/*.js` glob, so a story and the site run identical code.
 *
 * IT IS A SEPARATE ENTRY POINT RATHER THAN AN IMPORT INTO alpine.src.js because
 * Chart.js is the largest dependency the theme has, and folding it into the
 * bundle every page already loads would make every page pay for it. As its own
 * library file it is still attached up front — see bb_theme.libraries.yml for
 * why a swapped fragment may not fetch its own library — but it is one cached
 * file the browser can drop independently.
 */
import './../components/stat-comparison/stat-comparison.src.js';
import './../components/flow-chart/flow-chart.src.js';
