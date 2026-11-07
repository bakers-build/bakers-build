import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

function site(t, files, routes = {}) {
  const root = mkdtempSync(join(tmpdir(), 'manual-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'scripts'))
  copyFileSync(new URL('./check-site.mjs', import.meta.url), join(root, 'scripts/check-site.mjs'))
  writeFileSync(join(root, 'routes.json'), JSON.stringify(routes))
  // check-site.mjs also requires the bundled frameworks' license notices.
  files = { 'THIRD-PARTY-LICENSES.txt': '\n@vue/runtime-core@3\nvitepress@1\n', ...files }
  for (const [name, html] of Object.entries(files)) {
    const path = join(root, '.vitepress/dist', name)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, html)
  }
  return spawnSync(process.execPath, [join(root, 'scripts/check-site.mjs')], { encoding: 'utf8' })
}

test('rejects a missing destination in the landing page', t => {
  const result = site(t, { 'index.html': '<a href="/missing">Start</a>' })
  assert.equal(result.status, 1, result.stdout)
  assert.match(result.stdout, /missing page/)
})

test('accepts queries, encoded fragments, relative pages and assets', t => {
  const result = site(t, {
    'index.html': '<a href="/guide?from=home#hello%20world">Guide</a><a href="/logo.svg?v=1">Logo</a>',
    'guide.html': '<main id="hello world"><a href="./?from=guide">Home</a></main>',
  })
  assert.equal(result.status, 0, result.stdout)
})

const redirect = to => `<meta http-equiv="refresh" content="0;url=${to}">`

test('rejects a redirect whose target anchor is missing', t => {
  const result = site(t, {
    'old.html': redirect('/guide#missing'), 'guide.html': '<h1 id="guide">Guide</h1>',
  }, { '/old': '/guide#missing' })
  assert.equal(result.status, 1, result.stdout)
  assert.match(result.stdout, /missing anchor/)
})

test('rejects missing sidebar links and links to legacy pages', t => {
  const result = site(t, {
    'index.html': '<nav><a href="/missing">Missing</a><a href="/old">Old</a></nav>',
    'old.html': redirect('/guide'), 'guide.html': '<h1>Guide</h1>',
  }, { '/old': '/guide' })
  assert.equal(result.status, 1, result.stdout)
  assert.match(result.stdout, /missing page/)
  assert.match(result.stdout, /legacy route/)
})

test('rejects redirect chains and source collisions', t => {
  const result = site(t, {
    'first.html': redirect('/second'), 'second.html': redirect('/guide'),
    'collision.html': '<h1>Still content</h1>', 'guide.html': '<h1>Guide</h1>',
  }, { '/first': '/second', '/second': '/guide', '/collision': '/guide' })
  assert.equal(result.status, 1, result.stdout)
  assert.match(result.stdout, /itself a redirect/)
  assert.match(result.stdout, /still a content page/)
})

test('accepts a direct redirect to an existing anchor', t => {
  const result = site(t, {
    'old.html': redirect('/guide#setup'), 'guide.html': '<h1 id="setup">Setup</h1>',
  }, { '/old': '/guide#setup' })
  assert.equal(result.status, 0, result.stdout)
})

function navigation(t, mutate = () => {}) {
  const root = mkdtempSync(join(tmpdir(), 'manual-nav-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'docs/scripts'), { recursive: true })
  mkdirSync(join(root, 'docs/.vitepress'), { recursive: true })
  const areas = [
    { label: 'Get started', link: '/get-started/' },
    { label: 'Provision', link: '/provision/' },
    { label: 'Security', link: '/security/' },
    { label: 'Agents', link: '/agents/' },
    { label: 'Skills & Workflows', link: '/skills-and-workflows/' },
    { label: 'Addons', link: '/addons/' },
    { label: 'Configuration', link: '/configuration/' },
    { label: 'Self-hosting', link: '/self-hosting/' },
    { label: 'Development', link: '/development/' },
  ]
  const sidebar = Object.fromEntries(areas.map(({ label, link }) => [link, [{ text: label, items: [{ link }] }]]))
  sidebar['/get-started/'][0].items.push(...['connector', 'machine', 'connect-a-project', 'first-ticket'].map(slug => ({ link: `/get-started/${slug}` })))
  for (const route of [...areas.map(a => a.link), ...Object.values(sidebar).flatMap(gs => gs.flatMap(g => g.items.map(i => i.link)))]) {
    const file = join(root, 'docs', route.slice(1) + (route.endsWith('/') ? 'index.md' : '.md'))
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, '# Page\n')
  }
  sidebar['/get-started/'][0].items.push({ link: '/get-started/' })
  sidebar['/configuration/'][0].items.push({ link: '/configuration/' })
  mutate(areas, sidebar)
  copyFileSync(new URL('./check-pages.mjs', import.meta.url), join(root, 'docs/scripts/check-pages.mjs'))
  writeFileSync(join(root, 'docs/.vitepress/manual.mjs'), `export const AREAS = ${JSON.stringify(areas)}; export const SIDEBAR = ${JSON.stringify(sidebar)}; export const SRC_EXCLUDE = ['bakers/**'];`)
  return spawnSync(process.execPath, [join(root, 'docs/scripts/check-pages.mjs')], { encoding: 'utf8' })
}

test('requires exactly nine ordered manual areas', t => {
  const result = navigation(t, (areas, sidebar) => {
    areas.push({ label: 'Advanced', link: '/advanced/' })
  })
  assert.equal(result.status, 1, result.stdout)
  assert.match(result.stdout, /manual areas/)
})

test('accepts complete navigation and rejects missing setup or excluded sidebar destinations', t => {
  const valid = navigation(t)
  assert.equal(valid.status, 0, valid.stdout)
  const invalid = navigation(t, (_areas, sidebar) => {
    sidebar['/get-started/'][0].items = sidebar['/get-started/'][0].items.filter(i => i.link !== '/get-started/connector')
    sidebar['/addons/'][0].items.push({ link: '/development/architecture' })
  })
  assert.equal(invalid.status, 1, invalid.stdout)
  assert.match(invalid.stdout, /missing setup entry/)
  assert.match(invalid.stdout, /missing or excluded/)
})

test('redirect HTML preserves an incoming fragment unless its target specifies one', async () => {
  const { redirectPage } = await import('./redirects.mjs')
  const { runInNewContext } = await import('node:vm')
  for (const [target, hash, expected, anchors] of [
    ['/guide', '#sandbox-prerequisites', '/guide#sandbox-prerequisites'],
    ['/guide#setup', '#old-heading', '/guide#setup'],
    ['/guide', '', '/guide'],
    ['/guide', '#profiles', '/auth#profiles', { '#profiles': '/auth#profiles' }],
  ]) {
    const html = redirectPage(target, anchors)
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1]
    assert.ok(script, 'redirect must retain the incoming fragment')
    let destination
    runInNewContext(script, { location: { hash, replace: to => { destination = to } } })
    assert.equal(destination, expected)
    assert.ok(html.includes(`http-equiv="refresh" content="0;url=${target}"`), 'no-JS fallback remains')
  }
})
