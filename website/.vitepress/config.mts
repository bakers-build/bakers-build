import { defineConfigWithTheme, type DefaultTheme } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'
import tailwindcss from '@tailwindcss/vite'
import postcssConfig from '../postcss.config.mjs'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { AREAS, SIDEBAR, SRC_EXCLUDE } from './manual.mjs'
const require = createRequire(import.meta.url)
const vitepressRequire = createRequire(require.resolve('vitepress/package.json'))
const vueRoot = dirname(vitepressRequire.resolve('vue/package.json'))

// The public site is the merge gate's `docs` image (Dockerfile), built with the target
// branch and commit as build args; local builds are identified explicitly.
const { CI_COMMIT_REF_NAME, CI_COMMIT_SHORT_SHA } = process.env
const DOCS_VERSION = CI_COMMIT_SHORT_SHA ? `${CI_COMMIT_REF_NAME} · ${CI_COMMIT_SHORT_SHA}` : 'development'
const RELEASES_URL = 'https://www.npmjs.com/package/@bakers-build/bakers?activeTab=versions'

// The documentation areas (manual.mjs): the sidebar's icon strip (theme/
// components/SidebarAreas.vue) and the nav share this list. `match` is the path
// prefix that marks an area current; the icon keys are theme/components/area-icons.ts.
type Area = { label: string; link: string; icon: string; match?: string; external?: boolean }

// Every URL the site ever published keeps working: routes.json maps it to its
// current page, and buildEnd writes a one-hop redirect page for each entry.
// scripts/check-site.mjs fails the build when an entry chains or dangles.
const LEGACY_ROUTES: Record<string, string> = JSON.parse(
  readFileSync(fileURLToPath(new URL('../routes.json', import.meta.url)), 'utf8'),
)
const redirectPage = (to: string) =>
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Page moved</title>' +
  `<meta name="robots" content="noindex"><meta http-equiv="refresh" content="0;url=${to}">` +
  `<link rel="canonical" href="${to}"></head><body><p>This page moved to <a href="${to}">${to}</a>.</p></body></html>\n`

type BbThemeConfig = DefaultTheme.Config & {
  sidebarAreas: Area[]
  docsVersion: string
  releasesUrl: string
}

export default withMermaid(
  defineConfigWithTheme<BbThemeConfig>({
    srcDir: '../docs',
    srcExclude: SRC_EXCLUDE,
    rewrites: { 'index.md': 'manual.md', 'landing.md': 'index.md' },
    outDir: './.vitepress/dist',
    buildEnd(site) {
      for (const [from, to] of Object.entries(LEGACY_ROUTES)) {
        const file = join(site.outDir, from.endsWith('/') ? `${from.slice(1)}index.html` : `${from.slice(1)}.html`)
        // A source page still at the old path wins; check-site.mjs reports it.
        if (existsSync(file)) continue
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(file, redirectPage(to))
      }
    },
    title: 'bakers.build',
    description:
      'bakers.build — an AI-native ticket workflow: a Drupal control plane and the @bakers-build/bakers conductor CLI.',
    lang: 'en-US',
    cleanUrls: true,
    vite: {
      // srcDir is outside website; keep the theme CSS isolation config explicit.
      css: { postcss: postcssConfig },
      resolve: { alias: { vue: vueRoot } },
      publicDir: fileURLToPath(new URL('../public', import.meta.url)),
      plugins: [tailwindcss()],
    },
    sitemap: {
      // Prod is canonical; the develop docs host is not indexed under its own name.
      hostname: 'https://bakers.build',
    },
    // BB-427 D7: dark code blocks in both colour modes, as on Storybook's docs.
    markdown: {
      theme: 'github-dark',
    },
    head: [
      ['meta', { name: 'theme-color', content: '#0a0118' }],
      ['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
      // BB-427 D7: Nunito Sans for the documentation pages (docs.css scopes
      // it away from the landing). Preconnect first, then the stylesheet.
      ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
      ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
      [
        'link',
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Nunito+Sans:ital,opsz,wght@0,6..12,400;0,6..12,600;0,6..12,700;0,6..12,800;1,6..12,400&display=swap',
        },
      ],
      // Pre-paint gate for the landing page (like the prototype's `.js`
      // class): sets html.landing-page BEFORE first paint so the .sr
      // initial states (hidden, translateY) and the dark VP-nav palette
      // apply from the first frame — no visible-then-animate flash while
      // Vue hydrates. Landing.vue keeps owning the class for client-side
      // route enter/leave.
      [
        'script',
        {},
        "if(location.pathname==='/'||location.pathname==='/index.html'){document.documentElement.classList.add('landing-page')}",
      ],
    ],
    themeConfig: {
      // No socialLinks, no editLink — the repo host is internal-only; CTAs
      // point at npm.
      // The nav logo is the bakers.build mark plus the green wordmark, without the
      // tagline (unreadable at nav height); it works on light and dark alike,
      // so the text title is off.
      logo: '/logo-nav.svg',
      sidebarAreas: AREAS as Area[],
      docsVersion: DOCS_VERSION,
      releasesUrl: RELEASES_URL,
      // Kept as text for assistive technology; docs.css hides it visually on
      // the documentation pages, where the logo carries the wordmark.
      siteTitle: 'bakers.build',
      outline: { level: [2, 3], label: 'On this page' },
      docFooter: { prev: 'Previous', next: 'Next' },
      nav: AREAS.map(area => ({ text: area.label, link: area.link })),
      sidebar: SIDEBAR,
      search: {
        provider: 'local',
        options: {
          miniSearch: {
            searchOptions: {
              fuzzy: 0.2,
              prefix: true,
              boost: { title: 4, text: 2, titles: 1 },
            },
          },
          detailedView: true,
        },
      },
    },
    // vitepress-plugin-mermaid: render fenced ```mermaid blocks. Mermaid's
    // own theme follows the site theme (dark is forced in dark mode).
    // Mermaid 11's "neo" look (soft shadow, rounded nodes, thin edges). The
    // colours come from theme/mermaid-theme.ts through BbMermaid.vue, which
    // renders every diagram on the `base` theme in both colour schemes.
    mermaid: {
      look: 'neo',
      fontFamily: "'Nunito Sans', 'Inter', ui-sans-serif, system-ui, sans-serif",
      fontSize: 15,
    },
    mermaidPlugin: { class: 'mermaid' },
  }),
)
