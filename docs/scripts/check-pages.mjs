// Page-length and navigation gate for the manual (docs/). Counts prose words
// per rendered Markdown page - frontmatter, fenced code, HTML comments
// (including @include directives), link targets and inline tags excluded -
// and fails when a page exceeds its tier, has no tier, is in no sidebar, or
// is still a `draft: true` skeleton. The tiers and their reasons:
// docs/development/write-docs.md.
//
//   node scripts/check-pages.mjs              check every rendered page
//   node scripts/check-pages.mjs configuration/    check only pages under a prefix
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AREAS, SIDEBAR, SRC_EXCLUDE } from '../.vitepress/manual.mjs'
import { addonCoverage } from '../.vitepress/addon-options.mjs'

const DOCS = fileURLToPath(new URL('../../docs/', import.meta.url))
const AREA_INDEX = new Set(['index.md', ...AREAS.map(({ link }) => `${link.slice(1)}index.md`)])
const MAIN_AREAS = ['get-started/', 'addons/']
const REFERENCE_AREAS = ['configuration/', 'cli/', 'provision/', 'agents/', 'skills-and-workflows/', 'self-hosting/']
// landing.md and de/index.md render the Vue landing page (EN, DE); index.md is /manual,
// reached from the nav.
const NO_PROSE = new Set(['landing.md', 'de/index.md'])
const NO_SIDEBAR = new Set(['index.md', 'landing.md', 'de/index.md'])

function limitFor(rel) {
  if (AREA_INDEX.has(rel)) return 250
  // Detailed addon references keep the configuration tier after relocation.
  if (/^addons\/[^/]+\//.test(rel)) return 1500
  if (MAIN_AREAS.some((area) => rel.startsWith(area))) return 400
  if (REFERENCE_AREAS.some((area) => rel.startsWith(area))) return 1500
  return null
}

function proseWords(markdown) {
  const prose = markdown
    .replace(/^---\n[\s\S]*?\n---\n/, ' ')
    .replace(/^([^\S\n]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\2[^\S\n]*$/gm, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\]\([^)]*\)/g, ']')
    .replace(/<[^>]+>/g, ' ')
  return prose.split(/\s+/).filter((word) => /[A-Za-z]/.test(word)).length
}

const excluded = (rel) =>
  SRC_EXCLUDE.some((pattern) =>
    pattern.endsWith('/**') ? rel.startsWith(pattern.slice(0, -2)) : rel === pattern,
  )

const route = (rel) => '/' + rel.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '')

function sidebarLinks(items) {
  return items.flatMap((item) => [item.link, ...sidebarLinks(item.items ?? [])]).filter(Boolean)
}
const linked = new Set(Object.values(SIDEBAR).flatMap(sidebarLinks))

function pages(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return pages(path)
    return name.endsWith('.md') ? [relative(DOCS, path).split(sep).join('/')] : []
  })
}

const prefixes = process.argv.slice(2)
const selected = pages(DOCS)
  .filter((rel) => !excluded(rel) && !NO_PROSE.has(rel))
  .filter((rel) => prefixes.length === 0 || prefixes.some((prefix) => rel.startsWith(prefix)))
  .sort()

let total = 0
let failures = 0
function requireNavigation(condition, message) {
  if (!condition) {
    console.log(`FAIL ${message}`)
    failures++
  }
}
requireNavigation(
  JSON.stringify(AREAS.map(({ label, link }) => [label, link])) === JSON.stringify([
    ['Get started', '/get-started/'],
    ['Provision', '/provision/'],
    ['Agents', '/agents/'],
    ['Skills & Workflows', '/skills-and-workflows/'],
    ['Addons', '/addons/'],
    ['Configuration', '/configuration/'],
    ['Self-hosting', '/self-hosting/'],
  ]), 'manual areas must be Get started, Provision, Agents, Skills & Workflows, Addons, Configuration, Self-hosting in that order',
)
for (const slug of ['connector', 'connect-a-project', 'first-ticket']) {
  requireNavigation(
    sidebarLinks(SIDEBAR['/get-started/'] ?? []).includes(`/get-started/${slug}`),
    `missing setup entry: ${slug}`,
  )
}
// The security overview lives under Agents but stays on the provision path.
for (const link of ['/provision/machine', '/provision/guide', '/provision/tools', '/agents/security', '/provision/examples']) {
  requireNavigation(
    sidebarLinks(SIDEBAR['/provision/'] ?? []).includes(link),
    `missing provision entry: ${link}`,
  )
}
const publicRoutes = new Set(pages(DOCS)
  .filter(rel => !excluded(rel))
  .map(rel => rel === 'index.md' ? '/manual' : rel === 'landing.md' ? '/' : route(rel)))
for (const link of linked) requireNavigation(publicRoutes.has(link), `sidebar links missing or excluded page: ${link}`)
for (const area of AREAS) requireNavigation(publicRoutes.has(area.link), `area links missing page: ${area.link}`)
const coverage = addonCoverage()
for (const failure of coverage.failures) requireNavigation(false, failure)
for (const rel of selected) {
  const markdown = readFileSync(join(DOCS, rel), 'utf8')
  const words = proseWords(markdown)
  const limit = limitFor(rel)
  const front = markdown.match(/^---\n([\s\S]*?)\n---\n/)
  const problems = []
  if (limit === null) problems.push('no tier')
  else if (words > limit) problems.push(`over ${limit}`)
  if (!NO_SIDEBAR.has(rel) && !linked.has(route(rel))) problems.push('in no sidebar')
  if (front && /^draft:\s*true\s*$/m.test(front[1])) problems.push('draft')
  total += words
  if (problems.length > 0) failures++
  console.log(`${problems.length ? 'FAIL' : 'ok  '} ${String(words).padStart(5)} / ${limit ?? '-'}  ${rel}${problems.length ? '  (' + problems.join(', ') + ')' : ''}`)
}
console.log(`${selected.length} pages, ${total} prose words, ${failures} failing`)
process.exit(failures === 0 ? 0 : 1)
