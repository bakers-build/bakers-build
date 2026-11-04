// Theme entry: default theme extension (the ticket 02 decision). Tailwind
// loads before the default theme CSS so preflight sits under VitePress's
// own base styles; postcss.config.mjs isolates those with :where() so
// utilities win. landing.css is the theme layer of the custom landing
// (tokens, shared recipes, VP chrome overrides); the page itself is the
// globally registered <Landing /> rendered by the hero-less `layout: home`
// landing.md.
//
// docs.css is the documentation pages' look in the landing's brand, light
// only. It is imported AFTER the default theme so its
// equal-specificity overrides win by order, and every rule in it is scoped
// away from `html.landing-page`, so the landing is untouched.
import './tailwind.css'
import './landing.css'
// Without its bundled Inter files: the site's fonts come from Google Fonts, and shipping
// Inter would need its OFL notice (docs/bakers/licensing.md).
import DefaultTheme from 'vitepress/theme-without-fonts'
import './docs.css'
import { h } from 'vue'
import Landing from './landing/Landing.vue'
import LogoMark from './landing/LogoMark.vue'
import SidebarAreas from './components/SidebarAreas.vue'
import BbMermaid from './components/BbMermaid.vue'
import DocTiles from './components/DocTiles.vue'
import DocQuickLinks from './components/DocQuickLinks.vue'
import type { Theme } from 'vitepress'

/**
 * Diagram zoom (BB-427 D7): a click on any rendered Mermaid block opens a
 * copy of its SVG, fitted to the viewport width, in a fixed overlay; Escape, or a click on
 * the overlay, closes it. One delegated listener serves every page, so nothing
 * has to re-bind on route change. Client-only — guarded for SSR.
 */
function installDiagramZoom() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  let overlay: HTMLDivElement | null = null
  const close = () => {
    overlay?.remove()
    overlay = null
    document.removeEventListener('keydown', onKey)
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close()
  }
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null
    if (!target) return
    if (overlay && overlay.contains(target)) {
      close()
      return
    }
    const block = target.closest('.vp-doc .mermaid') as HTMLElement | null
    if (!block) return
    const svg = block.querySelector('svg')
    if (!svg) return
    const clone = svg.cloneNode(true) as SVGElement
    clone.removeAttribute('style')
    clone.removeAttribute('width')
    clone.removeAttribute('height')
    // Size from the viewBox: fit the viewport width, at most twice the natural
    // size (the inline render is already 1x on tall diagrams); the card
    // scrolls vertically for the rest. CSS `auto` on a viewBox-only SVG in a
    // shrink-to-fit card collapses to 0 x 0, so the size has to be explicit.
    const vb = (clone.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number)
    const [vbW, vbH] = vb.length === 4 ? [vb[2], vb[3]] : [svg.clientWidth, svg.clientHeight]
    if (vbW > 0 && vbH > 0) {
      const scale = Math.min((window.innerWidth * 0.92 - 48) / vbW, 2)
      clone.setAttribute('width', String(Math.round(vbW * scale)))
      clone.setAttribute('height', String(Math.round(vbH * scale)))
    }
    overlay = document.createElement('div')
    overlay.className = 'bakers-zoom'
    overlay.setAttribute('role', 'dialog')
    overlay.setAttribute('aria-label', 'Diagram, zoomed')
    const card = document.createElement('div')
    card.className = 'bakers-zoom__card'
    card.appendChild(clone)
    const hint = document.createElement('div')
    hint.className = 'bakers-zoom__hint'
    hint.textContent = 'Esc or click to close'
    overlay.appendChild(card)
    overlay.appendChild(hint)
    document.body.appendChild(overlay)
    document.addEventListener('keydown', onKey)
  })
}

export default {
  extends: DefaultTheme,
  // The docs sidebar opens with the area strip and the version row (D7),
  // through the default theme's own slot — no Layout fork.
  // The nav title shows the landing's mark and wordmark (the text title stays
  // for assistive tech, hidden by docs.css).
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      'sidebar-nav-before': () => h(SidebarAreas),
      'nav-bar-title-before': () =>
        h('span', { class: 'bb-wordmark', 'aria-hidden': 'true' }, [
          h(LogoMark, { size: 32, radius: 7 }),
          h('span', null, ['bakers', h('span', { class: 'bb-wordmark__dot' }, '.'), 'build']),
        ]),
    }),
  enhanceApp({ app }) {
    app.component('Landing', Landing)
    app.component('DocTiles', DocTiles)
    app.component('DocQuickLinks', DocQuickLinks)
    // Takes over the plugin's `Mermaid` registration (D7: our colours in both
    // schemes, fonts awaited before the first render).
    app.component('Mermaid', BbMermaid)
    installDiagramZoom()
  },
} satisfies Theme
