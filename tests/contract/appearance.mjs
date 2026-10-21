// node tests/contract/appearance.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
const root = new URL('../../web/themes/custom/bb_theme/', import.meta.url)
const require = createRequire(new URL('package.json', root))
const yaml = createRequire(require.resolve('storybook-addon-designbook'))('yaml')
const tokens = yaml.parse(readFileSync(new URL('designbook/design-system/design-tokens.yml', root), 'utf8'))
const source = readFileSync(new URL('js/skin.src.js', root), 'utf8')
function boot(values = {}, blocked = false) {
  const attrs = new Map(), stored = new Map(Object.entries(values)), events = []
  const window = {
    matchMedia: () => ({ matches: true }),
    localStorage: {
      getItem: k => { if (blocked) throw Error('blocked'); return stored.get(k) },
      setItem: (k, v) => { if (blocked) throw Error('blocked'); stored.set(k, v) },
    },
    dispatchEvent: event => events.push(event),
  }
  runInNewContext(source, {
    window, document: { documentElement: { setAttribute: (k,v) => attrs.set(k,v), getAttribute: k => attrs.get(k) } },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail } },
  })
  return { window, attrs, stored, events }
}
for (const blocked of [false, true]) {
  const app = boot({}, blocked)
  assert.equal(app.attrs.get('data-mode'), 'dark')
  for (const theme of ['bakers', 'harbor', 'grove', 'ember', 'iris']) {
    app.window.bakersSetTheme(theme)
    assert.equal(app.attrs.get('data-skin'), theme)
    assert.equal(app.attrs.get('data-mode'), 'dark')
    if (!blocked) assert.equal(boot(Object.fromEntries(app.stored)).attrs.get('data-skin'), theme)
  }
  assert.equal(app.window.bakersToggleMode(), 'light')
  assert.equal(app.attrs.get('data-skin'), 'iris')
  assert.equal(app.events.at(-1).detail.mode, 'light')
  assert.equal(app.window.bakersSetTheme('invalid'), 'bakers')
}
assert.equal(boot({'bakers-theme':'invalid', 'bakers-mode':'invalid'}).attrs.get('data-skin'), 'bakers')
assert.equal(boot({'bakers-theme':'grove', 'bakers-mode':'light'}).attrs.get('data-mode'), 'light')
function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map(v => parseInt(v,16)/255).map(v => v<=0.04045 ? v/12.92 : ((v+0.055)/1.055)**2.4)
  return channels[0]*0.2126+channels[1]*0.7152+channels[2]*0.0722
}
const ratio = (a,b) => (Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05)
for (const name of ['harbor','grove','ember','iris']) for (const suffix of ['', '-dark']) {
  const colors = tokens.themes[name+suffix].semantic.color
  for (const ink of ['text','text-light','text-faint','primary']) for (const surface of ['app','surface','surface-2','surface-3','input']) {
    const contrast=ratio(colors[ink].$value,colors[surface].$value)
    assert.ok(contrast >= 4.5, `${name+suffix} ${ink}/${surface}: ${contrast.toFixed(2)}`)
  }
  for (const surface of ['app','surface','surface-2']) assert.ok(ratio(colors['control-border'].$value,colors[surface].$value)>=3, name+suffix+' control border/'+surface)
  assert.ok(ratio(colors.primary.$value,colors['on-primary'].$value)>=4.5, name+suffix+' button text')
}
console.log('PASS: palette/mode persistence, blocked storage, invalid values, events and theme text contrast.')
