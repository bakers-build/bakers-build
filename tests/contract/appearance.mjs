// node tests/contract/appearance.mjs
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
const root = new URL('../../web/themes/custom/bb_theme/', import.meta.url)
const require = createRequire(new URL('package.json', root))
const yaml = createRequire(require.resolve('storybook-addon-designbook'))('yaml')
const tokens = yaml.parse(readFileSync(new URL('designbook/design-system/design-tokens.yml', root), 'utf8'))
const source = readFileSync(new URL('js/skin.src.js', root), 'utf8')

// Mode runtime: data-mode only, choice light | dark | system.
function boot(values = {}, { blocked = false, dark = false } = {}) {
  const attrs = new Map(), stored = new Map(Object.entries(values)), events = [], listeners = []
  const query = { matches: dark, addEventListener: (type, fn) => type === 'change' && listeners.push(fn) }
  const window = {
    matchMedia: () => query,
    localStorage: {
      getItem: k => { if (blocked) throw Error('blocked'); return stored.get(k) ?? null },
      setItem: (k, v) => { if (blocked) throw Error('blocked'); stored.set(k, v) },
    },
    dispatchEvent: event => events.push(event),
  }
  runInNewContext(source, {
    window, document: { documentElement: { setAttribute: (k, v) => attrs.set(k, v), getAttribute: k => attrs.get(k) } },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail } },
  })
  const scheme = matches => { query.matches = matches; listeners.forEach(fn => fn({ matches })) }
  return { window, attrs, stored, events, scheme }
}
for (const dark of [false, true]) {
  const app = boot({}, { dark })
  assert.equal(app.attrs.get('data-mode'), dark ? 'dark' : 'light', 'default follows the system')
  app.scheme(!dark)
  assert.equal(app.attrs.get('data-mode'), dark ? 'light' : 'dark', 'system follows a scheme change')
}
for (const blocked of [false, true]) {
  const app = boot({}, { blocked, dark: true })
  assert.equal(app.attrs.get('data-mode'), 'dark')
  for (const [choice, mode] of [['light', 'light'], ['dark', 'dark'], ['system', 'dark']]) {
    app.window.bakersSetMode(choice)
    assert.equal(app.attrs.get('data-mode'), mode, `choice ${choice}`)
    assert.deepEqual({ ...app.events.at(-1).detail }, { mode, choice })
    assert.equal(app.window.bakersModeChoice(), choice)
    if (!blocked) assert.equal(boot(Object.fromEntries(app.stored), { dark: true }).attrs.get('data-mode'), mode, `${choice} persists`)
  }
  app.window.bakersSetMode('light')
  app.scheme(false)
  app.scheme(true)
  assert.equal(app.attrs.get('data-mode'), 'light', 'an explicit choice ignores scheme changes')
  assert.equal(app.window.bakersSetMode('invalid'), 'dark', 'an invalid choice means system')
}
assert.equal(boot({ 'bakers-mode': 'invalid' }, { dark: true }).attrs.get('data-mode'), 'dark')
const legacy = boot({ 'bakers-theme': 'grove', 'bakers-mode': 'light' })
assert.equal(legacy.attrs.get('data-mode'), 'light')
assert.equal(legacy.attrs.has('data-skin'), false, 'a stored bakers-theme has no effect')
assert.equal(legacy.window.bakersSetTheme, undefined)

// No skin code left in the theme.
const skipped = new Set(['node_modules', 'dist', 'storybook-static', 'plans'])
const files = dir => readdirSync(dir).flatMap(name => {
  const path = `${dir}/${name}`
  if (skipped.has(name)) return []
  return statSync(path).isDirectory() ? files(path) : [path]
})
const themeDir = new URL('.', root).pathname.replace(/\/$/, '')
for (const path of files(themeDir).filter(path => /\.(js|mjs|twig|ya?ml|css|jsonata|theme|php)$/.test(path))) {
  const hit = readFileSync(path, 'utf8').match(/data-skin|bakersSetTheme|bakers-theme|\b(harbor|grove|ember|iris)\b/)
  assert.equal(hit, null, `${path.slice(themeDir.length)} still has skin code: ${hit?.[0]}`)
}
assert.equal(existsSync(new URL('css/tokens/appearance.src.css', root)), false)
assert.deepEqual(Object.keys(tokens.themes).sort(), ['cozy', 'dark'])

// CI colour values, read from the approved decision table.
const primitives = tokens.primitive.style
const resolve = value => value.startsWith('{')
  ? resolve(value.slice(1, -1).split('.').slice(2).reduce((node, key) => node[key], primitives).$value)
  : value.toUpperCase()
const palette = {
  light: Object.fromEntries(Object.entries(tokens.semantic.color).map(([name, token]) => [name, resolve(token.$value)])),
}
palette.dark = { ...palette.light, ...Object.fromEntries(Object.entries(tokens.themes.dark.semantic.color).map(([name, token]) => [name, resolve(token.$value)])) }
const decision = readFileSync(new URL('../../docs/decisions/app-appearance.md', import.meta.url), 'utf8')
const rows = decision.slice(decision.indexOf('## Tokens'), decision.indexOf('## Contrast')).split('\n').filter(line => /^\| [*a-z]/.test(line))
assert.ok(rows.length > 40, 'decision token table found')
for (const row of rows) {
  const [names, light, dark] = row.split('|').slice(1, 4).map(cell => cell.replace(/\*|\(new\)/g, '').trim())
  if (names === 'Token') continue
  const series = names.match(/^chart-series-a…f$/)
  const expanded = series ? 'abcdef'.split('').map(s => `chart-series-${s}`) : names.split(' / ')
  const values = mode => series ? mode.split(' · ') : expanded.map(() => mode)
  for (const [mode, cell] of [['light', light], ['dark', dark]]) expanded.forEach((name, i) => {
    assert.equal(palette[mode][name], values(cell)[i].toUpperCase(), `${mode} ${name}`)
  })
}
const brand = { flour: '#F5EBDA', rye: '#2B2116', butter: '#F3CE3A', lime: '#BFE07A', rose: '#F4AFC0', crust: '#B8692E', muted: '#8A7860' }
for (const [name, hex] of Object.entries(brand)) assert.equal(primitives.color[name]?.$value.toUpperCase(), hex, `brand primitive ${name}`)
assert.equal(tokens.semantic.color.primary.$value, '{primitive.style.color.rye}', 'light primary is rye')
assert.equal(tokens.themes.dark.semantic.color.primary.$value, '{primitive.style.color.butter}', 'dark primary is butter')

// WCAG 2.2 AA contrast on the rendered token pairs.
function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map(v => parseInt(v, 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}
const ratio = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05)
for (const [mode, colors] of Object.entries(palette)) {
  const check = (fg, bg, min) => {
    const contrast = ratio(colors[fg], colors[bg])
    assert.ok(contrast >= min, `${mode} ${fg} on ${bg}: ${contrast.toFixed(2)} < ${min}`)
  }
  for (const ink of ['text', 'text-light', 'text-faint']) for (const bg of ['app', 'surface', 'surface-2', 'surface-3', 'input']) check(ink, bg, 4.5)
  check('on-primary', 'primary', 4.5)
  for (const state of ['attention', 'running', 'unassigned', 'lease', 'offline']) check(`state-${state}-ink`, `state-${state}-tint`, 4.5)
  for (const bg of ['state-attention', 'state-review', 'state-done', 'avatar-a', 'avatar-b', 'avatar-c', 'avatar-d']) check('state-ink', bg, 4.5)
  const marks = ['control-border', 'focus-ring', 'state-attention-mark', 'state-running', 'state-unassigned', ...'abcdef'.split('').map(s => `chart-series-${s}`)]
  for (const mark of marks) for (const bg of ['surface', 'surface-2']) check(mark, bg, 3)
}
console.log('PASS: mode-only runtime (system, persistence, blocked storage, ignored skin), no skin code, CI values and contrast.')
