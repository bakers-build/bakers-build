import { defineConfig } from 'vite';
import { join, relative } from 'path';
import { globSync } from 'glob';
import tailwindcss from '@tailwindcss/vite';
import VitePluginSvgSpritemap from '@spiriit/vite-plugin-svg-spritemap';
import { readFileSync } from 'fs';
import { thirdPartyLicenses } from '../../../../docs/scripts/third-party.mjs';

export default defineConfig(() => {
  const projectRoot = __dirname;
  const entries = {};
  const { dependencies } = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));

  // CSS: css/<name>.src.css (skip _partials) -> dist/css/<name>.css
  for (const file of globSync(join(projectRoot, 'css/[!_]*.src.css'))) {
    const name = 'css/' + relative(join(projectRoot, 'css'), file).replace('.src.css', '');
    entries[name] = file;
  }

  // JS: js/<name>.src.js (skip _partials) -> dist/js/<name>.js
  for (const file of globSync(join(projectRoot, 'js/[!_]*.src.js'))) {
    const name = 'js/' + relative(join(projectRoot, 'js'), file).replace('.src.js', '');
    entries[name] = file;
  }

  return {
    // Relative asset URLs survive Drupal's CSS aggregation and subdirectory installs.
    base: './',
    plugins: [
      tailwindcss(),
      // Build the icon spritemap from assets/icons/src/*.svg → dist/icons/sprite.svg.
      // Symbol id = file name (prefix disabled), consumed by the icon SDC + the
      // bb_theme Icon API pack (extractor: svg_sprite).
      VitePluginSvgSpritemap('assets/icons/src/*.svg', {
        prefix: false,
        injectSVGOnDev: false,
        output: { filename: 'icons/sprite.svg', use: false, view: false },
        styles: false,
      }),
      // dist/THIRD-PARTY-LICENSES.txt: bundled runtime packages, Tailwind's generated CSS,
      // Alpine's license (its packages ship none), the Feather/Lucide icons in the sprite
      // and the OFL fonts copied into dist (docs/bakers/licensing.md).
      thirdPartyLicenses({
        packages: [...Object.keys(dependencies), 'tailwindcss'],
        noticeFiles: ['js/alpine.NOTICE', 'assets/icons/NOTICE', ...globSync('css/fonts/*.LICENSE', { cwd: projectRoot }).sort()],
      }),
    ],
    css: { postcss: false },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      minify: process.env.NODE_ENV === 'production',
      rollupOptions: {
        input: entries,
        output: {
          assetFileNames: '[name].[ext]',
          entryFileNames: '[name].js',
        },
      },
    },
  };
});
