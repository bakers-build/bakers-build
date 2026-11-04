import { postcssIsolateStyles } from 'vitepress'

// Exclude .vp-raw component trees from the default theme's base/prose rules
// so its unlayered resets do not override the landing's Tailwind utilities.
export default {
  plugins: [
    postcssIsolateStyles({
      includeFiles: [/vp-doc\.css/, /base\.css/],
    }),
  ],
}
