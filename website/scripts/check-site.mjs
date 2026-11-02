// Built-site gate for the manual. VitePress fails the build on a dead page
// link but never checks #anchors or the legacy redirects, so this reads the
// built HTML and fails when an internal link's page or anchor is missing, a
// page links a legacy route instead of its destination, or a routes.json
// entry is not a one-hop redirect to a real page.
//
//   node scripts/check-site.mjs              check the whole site
//   node scripts/check-site.mjs /configuration/   report only problems under a prefix
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const WEBSITE = fileURLToPath(new URL('..', import.meta.url))
const DIST = join(WEBSITE, '.vitepress', 'dist')
const ROUTES = JSON.parse(readFileSync(join(WEBSITE, 'routes.json'), 'utf8'))
const ASSET = /\.(svg|png|jpe?g|gif|webp|ico|txt|xml|json|js|css|pdf)$/

const pages = new Map()
function collect(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      collect(path)
      continue
    }
    if (!name.endsWith('.html')) continue
    const html = readFileSync(path, 'utf8')
    const route = ('/' + relative(DIST, path).split(sep).join('/'))
      .replace(/(^|\/)index\.html$/, '$1')
      .replace(/\.html$/, '')
    const refresh = html.match(/http-equiv="refresh" content="0;url=([^"]+)"/)
    pages.set(route, {
      ids: new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])),
      hrefs: [...html.matchAll(/<a\s[^>]*href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&')),
      redirect: refresh ? refresh[1] : null,
    })
  }
}
collect(DIST)

function lookup(path) {
  const clean = path.replace(/\.html$/, '').replace(/\/index$/, '/') || '/'
  if (pages.has(clean)) return clean
  if (pages.has(`${clean}/`)) return `${clean}/`
  return null
}

const problems = []
const report = (where, message) => problems.push({ where, message })

for (const [route, page] of pages) {
  if (page.redirect) continue
  for (const href of page.hrefs) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) continue
    const url = new URL(href, `https://manual.test${route}`)
    const path = url.pathname
    const fragment = url.hash.slice(1)
    if (ASSET.test(path)) continue
    const target = lookup(path)
    if (target === null) {
      report(route, `links a missing page: ${href}`)
      continue
    }
    const linkedPage = pages.get(target)
    if (linkedPage.redirect) {
      report(route, `links the legacy route ${target}; link ${linkedPage.redirect}`)
      continue
    }
    if (fragment && !linkedPage.ids.has(decodeURIComponent(fragment))) report(route, `links a missing anchor: ${href}`)
  }
}

for (const [from, to] of Object.entries(ROUTES)) {
  const [fromPath, fromAnchor] = from.split('#')
  const page = pages.get(fromPath)
  if (!page) report(from, 'legacy route has no redirect page')
  else if (fromAnchor) {
    const [toPath, toAnchor] = to.split('#')
    if (!page.redirect) report(from, 'anchor route on a content page; give it a routes.json path entry')
    if (toAnchor && !pages.get(lookup(toPath))?.ids.has(toAnchor)) report(from, `redirect target ${to} has no such anchor`)
  } else if (page.redirect !== to)
    report(from, page.redirect ? `redirects to ${page.redirect}, routes.json says ${to}` : 'is still a content page; delete its source or its routes.json entry')
  const url = new URL(to, 'https://manual.test')
  const target = lookup(url.pathname)
  if (target === null) report(from, `redirect target ${to} does not exist`)
  else if (pages.get(target).redirect) report(from, `redirect target ${to} is itself a redirect; point at ${pages.get(target).redirect}`)
  else if (url.hash && !pages.get(target).ids.has(decodeURIComponent(url.hash.slice(1))))
    report(from, `redirect target has a missing anchor: ${to}`)
}

// The bundled frameworks' MIT notices live only in this file (scripts/third-party.mjs).
let notices = ''
try {
  notices = readFileSync(join(DIST, 'THIRD-PARTY-LICENSES.txt'), 'utf8')
} catch {}
for (const name of ['@vue/runtime-core', 'vitepress'])
  if (!notices.includes(`\n${name}@`)) report('/THIRD-PARTY-LICENSES.txt', `does not list the bundled ${name} package`)
if (notices.includes('ships no license file'))
  report('/THIRD-PARTY-LICENSES.txt', 'a bundled package has no license text; add it to docs/bakers/licensing.md')
// Font files are assets, not JS modules, so third-party.mjs never lists them; the site ships none.
for (const name of readdirSync(DIST, { recursive: true }))
  if (/\.(woff2?|ttf|otf|eot)$/i.test(name))
    report('/' + name.split(sep).join('/'), 'font file without a license notice; load it from a host or add its license to docs/bakers/licensing.md')

const prefixes = process.argv.slice(2)
const shown = problems.filter(({ where }) => prefixes.length === 0 || prefixes.some((prefix) => where.startsWith(prefix)))
for (const { where, message } of shown) console.log(`${where}: ${message}`)
console.log(`${pages.size} built pages, ${Object.keys(ROUTES).length} legacy routes, ${shown.length} problems`)
process.exit(shown.length === 0 ? 0 : 1)
