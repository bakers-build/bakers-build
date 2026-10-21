/**
 * @file
 * Entry point that ships the Markdown toolbar behind form_rich_text.
 *
 * The behaviour lives beside its component
 * (components/form_rich_text/form_rich_text.src.js); this file only gives Vite
 * an entry point for it, as chart.src.js does for stat-comparison. Storybook
 * reaches the same source through its `components/**\/*.js` glob.
 *
 * It is attached up front in bb_theme/global because the body forms arrive as
 * htmx fragments — see bb_theme.libraries.yml for why a swapped fragment may
 * not fetch its own library.
 */
import './../components/form_rich_text/form_rich_text.src.js';
